const express = require("express");
const router = express.Router();
require("dotenv").config({ path: "../.env" });
const { supabase } = require("../server"); // Import only supabase
const { authenticateToken } = require("../middleware/authMiddleware"); // Import middleware

// --- Stripe Initialization ---
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

let stripe = null;
if (!stripeSecretKey || !stripePublishableKey) {
    console.error("Erro: Chaves Stripe (Secret e Publishable) não configuradas no .env");
} else {
    stripe = require("stripe")(stripeSecretKey);
}

// --- Endpoint to Create Payment Intent --- 
// POST /api/payments/create-payment-intent
// Apply middleware here if not applied globally in server.js for this path
router.post("/create-payment-intent", authenticateToken, async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: "Configuração do Stripe incompleta no servidor." });
    }
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }

    const { serviceId } = req.body; 
    const clientId = req.user.id; // Get client ID from authenticated user

    if (!serviceId) {
        return res.status(400).json({ error: "ID do serviço é obrigatório." });
    }

    try {
        // 1. Get Service Details (Price and Provider ID)
        const { data: serviceData, error: serviceError } = await supabase
            .from("services")
            .select("price, provider_id, title")
            .eq("id", serviceId)
            .eq("is_active", true)
            .single();

        if (serviceError || !serviceData) {
            console.error("Erro ao buscar serviço ou serviço inativo:", serviceError);
            return res.status(404).json({ error: "Serviço não encontrado ou indisponível." });
        }

        const servicePrice = parseFloat(serviceData.price);
        const providerId = serviceData.provider_id;
        const serviceTitle = serviceData.title;

        if (isNaN(servicePrice) || servicePrice <= 0) {
            return res.status(400).json({ error: "Preço do serviço inválido." });
        }

        // 2. Create a Booking Record (initially pending payment)
        const { data: bookingData, error: bookingError } = await supabase
            .from("bookings")
            .insert({
                client_id: clientId,
                service_id: serviceId,
                provider_id: providerId,
                status: "pending_payment", 
                total_price: servicePrice
            })
            .select("id") 
            .single();

        if (bookingError || !bookingData) {
            console.error("Erro ao criar registro de agendamento:", bookingError);
            return res.status(500).json({ error: "Não foi possível iniciar o agendamento." });
        }

        const bookingId = bookingData.id;

        // 3. Create Stripe Payment Intent
        const amountInCents = Math.round(servicePrice * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: "brl", 
            metadata: { 
                booking_id: bookingId,
                client_id: clientId,
                service_id: serviceId,
                provider_id: providerId
            },
            description: `Pagamento para serviço: ${serviceTitle} (Booking ID: ${bookingId})`,
        });

        // 4. Create Payment Record (linking booking and payment intent)
        const { data: paymentData, error: paymentInsertError } = await supabase
            .from("payments")
            .insert({
                booking_id: bookingId,
                gateway_transaction_id: paymentIntent.id, 
                amount: servicePrice,
                status: "pending", 
                payment_method: null 
            })
            .select("id") // Select the ID of the inserted payment
            .single();

        if (paymentInsertError || !paymentData) {
            console.error("Erro ao criar registro de pagamento:", paymentInsertError);
            return res.status(500).json({ error: "Erro ao registrar detalhes do pagamento." });
        }
        
        const paymentId = paymentData.id;

        // 5. Update Booking with Payment ID
        const { error: bookingUpdateError } = await supabase
            .from("bookings")
            .update({ payment_id: paymentId })
            .eq("id", bookingId);
        
        if (bookingUpdateError) {
             console.error("Erro ao atualizar booking com payment_id:", bookingUpdateError);
        }

        // 6. Send the client secret back to the frontend
        res.send({
            clientSecret: paymentIntent.client_secret,
            bookingId: bookingId,
            publishableKey: stripePublishableKey 
        });

    } catch (error) {
        console.error("Erro ao criar Payment Intent:", error);
        res.status(500).json({ error: "Erro interno ao processar pagamento." });
    }
});


// --- Webhook Helper Functions ---
// These functions are used by the webhook handler defined in server.js
async function handlePaymentSuccess(paymentIntent) {
    if (!supabase) {
        console.error("handlePaymentSuccess: Supabase client not available.");
        return;
    }
    const paymentIntentId = paymentIntent.id;
    const bookingId = paymentIntent.metadata.booking_id;
    const paymentMethod = paymentIntent.payment_method_types ? paymentIntent.payment_method_types[0] : 'unknown';

    if (!bookingId) {
        console.error(`Erro no webhook: Booking ID não encontrado nos metadados do PaymentIntent ${paymentIntentId}`);
        return; 
    }

    try {
        // Update Payment record
        const { error: paymentUpdateError } = await supabase
            .from("payments")
            .update({
                status: "held", 
                paid_at: new Date(paymentIntent.created * 1000), 
                payment_method: paymentMethod
            })
            .eq("gateway_transaction_id", paymentIntentId);

        if (paymentUpdateError) {
            console.error(`Erro ao atualizar status do pagamento ${paymentIntentId} para 'held':`, paymentUpdateError);
        }

        // Update Booking record
        const { error: bookingUpdateError } = await supabase
            .from("bookings")
            .update({
                status: "confirmed" 
            })
            .eq("id", bookingId)
            .eq("status", "pending_payment"); 

        if (bookingUpdateError) {
            console.error(`Erro ao atualizar status do booking ${bookingId} para 'confirmed':`, bookingUpdateError);
        } else {
            console.log(`Booking ${bookingId} status atualizado para 'confirmed' após pagamento.`);
            // TODO: Notify provider
        }

    } catch (err) {
        console.error(`Erro inesperado ao processar sucesso do PaymentIntent ${paymentIntentId}:`, err);
    }
}

async function handlePaymentFailure(paymentIntent) {
     if (!supabase) {
        console.error("handlePaymentFailure: Supabase client not available.");
        return;
    }
    const paymentIntentId = paymentIntent.id;
    const bookingId = paymentIntent.metadata.booking_id;

    if (!bookingId) {
        console.error(`Erro no webhook: Booking ID não encontrado nos metadados do PaymentIntent ${paymentIntentId} (falha)`);
        return;
    }

    try {
        // Update Payment record
        const { error: paymentUpdateError } = await supabase
            .from("payments")
            .update({ status: "failed" })
            .eq("gateway_transaction_id", paymentIntentId);

        if (paymentUpdateError) {
            console.error(`Erro ao atualizar status do pagamento ${paymentIntentId} para 'failed':`, paymentUpdateError);
        }

        // Update Booking record
        const { error: bookingUpdateError } = await supabase
            .from("bookings")
            .update({ status: "cancelled" }) 
            .eq("id", bookingId)
            .eq("status", "pending_payment");

        if (bookingUpdateError) {
            console.error(`Erro ao atualizar status do booking ${bookingId} para 'cancelled' após falha no pagamento:`, bookingUpdateError);
        } else {
            console.log(`Booking ${bookingId} status atualizado para 'cancelled' após falha no pagamento.`);
            // TODO: Notify client
        }

    } catch (err) {
        console.error(`Erro inesperado ao processar falha do PaymentIntent ${paymentIntentId}:`, err);
    }
}

// Define the webhook handler function separately for export
const handleWebhook = async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: "Configuração do Stripe incompleta no servidor." });
    }
    
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret || webhookSecret === 'whsec_YOUR_STRIPE_WEBHOOK_SECRET') {
        console.error("Erro: Stripe Webhook Secret não configurado ou inválido no .env");
        // Return 200 to Stripe even if we can't process, to avoid retries during testing without secret
        // In production, you might return 500 or 400 if the secret is missing.
        // return res.status(500).send("Webhook secret não configurado."); 
        console.warn("Webhook recebido, mas não processado devido à falta de Webhook Secret.");
        return res.json({ received: true, warning: "Webhook Secret not configured" }); 
    }

    let event;

    try {
        // Use req.body directly as express.raw provides the raw buffer
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case "payment_intent.succeeded":
            const paymentIntentSucceeded = event.data.object;
            console.log("Webhook processando: payment_intent.succeeded", paymentIntentSucceeded.id);
            await handlePaymentSuccess(paymentIntentSucceeded);
            break;
        case "payment_intent.payment_failed":
            const paymentIntentFailed = event.data.object;
            console.log("Webhook processando: payment_intent.payment_failed", paymentIntentFailed.id);
            await handlePaymentFailure(paymentIntentFailed);
            break;
        default:
            console.log(`Webhook: Evento não tratado ${event.type}`);
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
};


// Export the router for regular routes AND the specific webhook handler
module.exports = { router, handleWebhook };

