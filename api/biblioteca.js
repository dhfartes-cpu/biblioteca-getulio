import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET: Lista todos os livros ou reservas cadastradas
    if (req.method === 'GET') {
      const { tipo } = req.query; // 'livros' ou 'reservas'
      
      if (tipo === 'reservas') {
        const reservasKeys = await kv.keys('reserva:*');
        const reservas = [];
        for (const key of reservasKeys) {
          const item = await kv.get(key);
          reservas.push(item);
        }
        return res.status(200).json(reservas);
      }

      // Padrão: Retorna os livros
      const livrosKeys = await kv.keys('livro:*');
      const livros = [];
      for (const key of livrosKeys) {
        const item = await kv.get(key);
        livros.push(item);
      }
      return res.status(200).json(livros);
    }

    // POST: Cadastra um novo livro ou faz uma reserva
    if (req.method === 'POST') {
      const { acao, titulo, autor, ano, genero, isbn, nomeAluno, turma, emailAluno, livroId } = req.body;

      // Ação de cadastrar livro
      if (acao === 'cadastrar_livro') {
        if (!titulo || !autor) {
          return res.status(400).json({ erro: 'Título e Autor são obrigatórios!' });
        }
        const id = Date.now().toString();
        const novoLivro = { id, titulo, autor, ano, genero, isbn, status: 'DISPONIVEL' };
        
        await kv.set(`livro:${id}`, novoLivro);
        return res.status(200).json({ mensagem: 'Livro cadastrado com sucesso!', livro: novoLivro });
      }

      // Ação de reservar livro
      if (acao === 'reservar') {
        if (!nomeAluno || !turma || !livroId) {
          return res.status(400).json({ erro: 'Nome do aluno, turma e ID do livro são obrigatórios!' });
        }
        const reservaId = Date.now().toString();
        const novaReserva = {
          id: reservaId,
          livroId,
          nomeAluno,
          turma,
          emailAluno: emailAluno || '',
          status: 'PENDENTE',
          data: new Date().toISOString()
        };

        await kv.set(`reserva:${reservaId}`, novaReserva);
        return res.status(200).json({ mensagem: 'Reserva realizada com sucesso!', reserva: novaReserva });
      }

      return res.status(400).json({ erro: 'Ação inválida!' });
    }

    return res.status(405).json({ erro: 'Método não permitido' });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}