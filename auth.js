const express = require('express');
const router = express.Router();
const { supabase } = require('../server'); // Import Supabase client from server.js

// Rota para Registro (Sign Up)
router.post('/signup', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Cliente Supabase não inicializado.' });
  }
  const { email, password, phone_number, full_name, role } = req.body;

  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Email, senha, nome completo e tipo de usuário (role) são obrigatórios.' });
  }

  if (role !== 'client' && role !== 'provider') {
    return res.status(400).json({ error: 'Tipo de usuário (role) inválido. Use "client" ou "provider".' });
  }

  try {
    // 1. Criar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { // Dados adicionais a serem armazenados na tabela auth.users (metadata)
          full_name: full_name,
          role: role // Armazena o role aqui também para fácil acesso inicial
        }
      }
    });

    if (authError) {
      console.error('Erro no Supabase Auth SignUp:', authError);
      // Verifica se o erro é de usuário já registrado
      if (authError.message.includes('User already registered')) {
          return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
      }
      return res.status(500).json({ error: authError.message || 'Erro ao registrar usuário no Auth.' });
    }

    if (!authData || !authData.user) {
        return res.status(500).json({ error: 'Não foi possível obter os dados do usuário após o registro no Auth.' });
    }

    const userId = authData.user.id;

    // 2. Inserir dados na tabela 'users' (se você tiver uma tabela separada além da auth.users)
    //    e na tabela específica ('clients' ou 'providers')
    //    É crucial que a tabela 'users' exista ou que você adapte para usar apenas auth.users e as tabelas 'clients'/'providers'

    // Inserir na tabela 'users' (assumindo que ela existe conforme modelo)
    const { error: userInsertError } = await supabase
      .from('users')
      .insert({
        id: userId, // Usa o ID retornado pelo Auth
        email: email,
        phone_number: phone_number,
        full_name: full_name,
        role: role
      });

    if (userInsertError) {
      console.error('Erro ao inserir na tabela users:', userInsertError);
      // Idealmente, deveria tentar deletar o usuário do Auth aqui (rollback)
      return res.status(500).json({ error: 'Erro ao salvar dados do usuário.' });
    }

    // 3. Inserir na tabela específica (clients ou providers)
    const targetTable = role === 'client' ? 'clients' : 'providers';
    const { error: roleInsertError } = await supabase
      .from(targetTable)
      .insert({ user_id: userId }); // Adiciona apenas o user_id inicialmente

    if (roleInsertError) {
      console.error(`Erro ao inserir na tabela ${targetTable}:`, roleInsertError);
      // Idealmente, deveria tentar deletar o usuário do Auth e da tabela 'users' (rollback)
      return res.status(500).json({ error: `Erro ao criar perfil de ${role}.` });
    }

    // Retorna sucesso (sem a sessão, pois o Supabase geralmente requer confirmação de email)
    // O frontend deve lidar com o estado de confirmação.
    res.status(201).json({ message: 'Usuário registrado com sucesso! Verifique seu e-mail para confirmação.', userId: userId });

  } catch (err) {
    console.error('Erro inesperado no signup:', err);
    res.status(500).json({ error: 'Erro inesperado no servidor durante o registro.' });
  }
});

// Rota para Login (Sign In)
router.post('/signin', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Cliente Supabase não inicializado.' });
  }
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Erro no Supabase Auth SignIn:', error);
       if (error.message.includes('Invalid login credentials')) {
           return res.status(401).json({ error: 'Credenciais inválidas.' });
       }
       if (error.message.includes('Email not confirmed')) {
            return res.status(401).json({ error: 'E-mail ainda não confirmado. Verifique sua caixa de entrada.' });
       }
      return res.status(401).json({ error: error.message || 'Falha na autenticação.' });
    }

    // Login bem-sucedido, retorna os dados da sessão (inclui token JWT)
    res.json(data);

  } catch (err) {
    console.error('Erro inesperado no signin:', err);
    res.status(500).json({ error: 'Erro inesperado no servidor durante o login.' });
  }
});

// Rota para Logout (Sign Out)
// O logout no Supabase geralmente é feito no lado do cliente invalidando o token.
// Esta rota pode ser usada para operações adicionais no backend se necessário.
router.post('/signout', async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: 'Cliente Supabase não inicializado.' });
    }
    try {
        // Tenta invalidar o token atual no Supabase (requer que o token seja enviado na requisição)
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Erro no Supabase Auth SignOut:', error);
            // Mesmo com erro, o cliente deve remover o token localmente
            return res.status(500).json({ error: 'Erro ao tentar fazer logout no servidor.' });
        }
        res.json({ message: 'Logout realizado com sucesso no servidor.' });
    } catch (err) {
        console.error('Erro inesperado no signout:', err);
        res.status(500).json({ error: 'Erro inesperado no servidor durante o logout.' });
    }
});


module.exports = router;

