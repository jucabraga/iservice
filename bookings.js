const express = require("express");
const router = express.Router();
require("dotenv").config({ path: "../.env" });
const { supabase } = require("../server"); // Import only supabase
const { authenticateToken } = require("../middleware/authMiddleware"); // Import middleware

// Middleware to check if the authenticated user is the client of the booking
const isBookingClient = async (req, res, next) => {
    const bookingId = req.params.id;
    const clientId = req.user.id; // Assumes authenticateToken ran before

    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select("client_id")
            .eq("id", bookingId)
            .single();

        if (error || !data) {
            console.error("Erro ao buscar agendamento ou agendamento não encontrado:", error);
            return res.status(404).json({ error: "Agendamento não encontrado." });
        }

        if (data.client_id !== clientId) {
            return res.status(403).json({ error: "Acesso negado. Você não é o cliente deste agendamento." });
        }

        req.booking = data; // Attach booking data if needed later
        next(); // User is the client, proceed
    } catch (err) {
        console.error("Erro inesperado ao verificar cliente do agendamento:", err);
        res.status(500).json({ error: "Erro interno ao verificar cliente do agendamento." });
    }
};

// --- Booking Routes ---

// GET /api/bookings/my-bookings - List bookings for the logged-in user (client or provider)
// Note: authenticateToken is applied globally in server.js for /api/bookings
router.get("/my-bookings", async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const userId = req.user.id;
    const userRole = req.user.user_metadata.role;

    try {
        let query = supabase.from("bookings").select(`
            *,
            services (*, categories(name)),
            clients:client_id ( users (full_name) ),
            providers:provider_id ( users (full_name) ),
            payments ( status, amount )
        `);

        if (userRole === 'client') {
            query = query.eq('client_id', userId);
        } else if (userRole === 'provider') {
            query = query.eq('provider_id', userId);
        } else {
            // Should not happen if roles are enforced, but good to check
            return res.status(403).json({ error: "Tipo de usuário inválido para esta consulta." });
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            console.error("Erro ao buscar agendamentos:", error);
            return res.status(500).json({ error: "Erro interno ao buscar agendamentos." });
        }

        res.json(data);

    } catch (err) {
        console.error("Erro inesperado ao buscar agendamentos:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});


// POST /api/bookings/:id/confirm-completion - Client confirms service completion
// Note: authenticateToken is applied globally in server.js
router.post("/:id/confirm-completion", isBookingClient, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const bookingId = req.params.id;
    const commissionPercentage = parseFloat(process.env.PLATFORM_COMMISSION_PERCENTAGE || 10);

    try {
        // 1. Fetch Booking and Payment details
        const { data: bookingData, error: fetchError } = await supabase
            .from("bookings")
            .select(`
                status,
                total_price,
                payments ( id, status, amount, gateway_transaction_id )
            `)
            .eq("id", bookingId)
            .single();

        if (fetchError || !bookingData) {
            console.error("Erro ao buscar agendamento para confirmação:", fetchError);
            return res.status(404).json({ error: "Agendamento não encontrado." });
        }

        if (!["confirmed", "pending_client_approval"].includes(bookingData.status)) {
             return res.status(400).json({ error: `Não é possível confirmar a conclusão. Status atual: ${bookingData.status}` });
        }

        if (!bookingData.payments || bookingData.payments.status !== 'held') {
            return res.status(400).json({ error: "Pagamento não está retido ou não encontrado. Não é possível liberar." });
        }

        const paymentId = bookingData.payments.id;
        const totalAmount = parseFloat(bookingData.payments.amount);

        // 2. Calculate Commission and Provider Amount
        const platformFee = (totalAmount * commissionPercentage) / 100;
        const amountToProvider = totalAmount - platformFee;

        // 3. Update Booking Status to 'completed'
        const { error: bookingUpdateError } = await supabase
            .from("bookings")
            .update({ status: "completed", updated_at: new Date() })
            .eq("id", bookingId);

        if (bookingUpdateError) {
            console.error(`Erro ao atualizar status do booking ${bookingId} para 'completed':`, bookingUpdateError);
            return res.status(500).json({ error: "Erro ao finalizar o agendamento." });
        }

        // 4. Update Payment Status to 'released'
        const { error: paymentUpdateError } = await supabase
            .from("payments")
            .update({
                status: "released",
                platform_fee: platformFee.toFixed(2),
                amount_released_to_provider: amountToProvider.toFixed(2),
                released_at: new Date()
            })
            .eq("id", paymentId);

        if (paymentUpdateError) {
            console.error(`Erro ao atualizar status do pagamento ${paymentId} para 'released':`, paymentUpdateError);
            return res.status(500).json({ error: "Agendamento finalizado, mas houve erro ao registrar a liberação do pagamento." });
        }

        // 5. *** Trigger Actual Payout to Provider (Stripe Connect / Transfers) ***
        console.log(`Simulating Payout: Transferindo R$ ${amountToProvider.toFixed(2)} para o prestador associado ao booking ${bookingId}.`);
        // Actual Stripe Connect transfer logic would go here

        console.log(`Booking ${bookingId} concluído e pagamento ${paymentId} liberado (simulado).`);
        res.json({ message: "Serviço confirmado com sucesso! Pagamento liberado para o prestador." });

    } catch (err) {
        console.error(`Erro inesperado ao confirmar conclusão do booking ${bookingId}:`, err);
        res.status(500).json({ error: "Erro interno ao confirmar a conclusão do serviço." });
    }
});

module.exports = router;

