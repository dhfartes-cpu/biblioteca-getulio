import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // PIN da Bibliotecária (configure ADMIN_PIN na Vercel ou use 1234 como padrão)
  const PIN_CORRETO = process.env.ADMIN_PIN || '1234';

  try {
    // GET: Lista livros, alunos ou horários/reservas do espaço
    if (req.method === 'GET') {
      const { tipo } = req.query;

      let prefixo = 'livro:*';
      if (tipo === 'alunos') prefixo = 'aluno:*';
      if (tipo === 'espacos') prefixo = 'espaco:*';

      const keys = await kv.keys(prefixo);
      const itens = [];
      for (const key of keys) {
        const item = await kv.get(key);
        if (item) itens.push(item);
      }
      return res.status(200).json(itens);
    }

    // POST: Operações de cadastro, empréstimo, agenda e exclusão
    if (req.method === 'POST') {
      const {
        acao, id, titulo, autor, capa, categoria, codigo,
        leitor, turma, contato, prof, data, horario, pin, tipoItem, itemId
      } = req.body;

      // 1. Cadastrar Livro
      if (acao === 'cadastrar') {
        if (!titulo || !autor) return res.status(400).json({ erro: 'Título e Autor são obrigatórios.' });
        const livroId = id || Date.now().toString();
        const novoLivro = {
          id: livroId,
          titulo,
          autor,
          capa: capa || '',
          categoria: categoria || 'Geral',
          codigo: codigo || '',
          disponivel: true
        };
        await kv.set(`livro:${livroId}`, novoLivro);
        return res.status(200).json({ mensagem: 'Livro salvo!', livro: novoLivro });
      }

      // 2. Emprestar / Reservar Livro
      if (acao === 'reservar') {
        const livroKey = `livro:${id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado' });

        livro.disponivel = false;
        livro.leitor = leitor;
        livro.turma = turma;
        livro.dataReserva = new Date().toISOString();
        await kv.set(livroKey, livro);
        return res.status(200).json({ mensagem: 'Empréstimo registrado!', livro });
      }

      // 3. Devolver Livro
      if (acao === 'devolver') {
        const livroKey = `livro:${id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado' });

        livro.disponivel = true;
        delete livro.leitor;
        delete livro.turma;
        delete livro.dataReserva;
        await kv.set(livroKey, livro);
        return res.status(200).json({ mensagem: 'Devolução registrada!', livro });
      }

      // 4. Cadastrar Aluno
      if (acao === 'cadastrar_aluno') {
        const alunoId = Date.now().toString();
        const novoAluno = {
          id: alunoId,
          nome: leitor || req.body.nome,
          turma,
          contato: contato || ''
        };
        await kv.set(`aluno:${alunoId}`, novoAluno);
        return res.status(200).json({ mensagem: 'Aluno cadastrado!', aluno: novoAluno });
      }

      // 5. Bibliotecária: Liberar Horário Disponível no Espaço Físico (Exige PIN)
      if (acao === 'liberar_horario') {
        if (pin !== PIN_CORRETO) {
          return res.status(403).json({ erro: 'PIN da bibliotecária incorreto!' });
        }
        const espacoId = Date.now().toString();
        const slot = {
          id: espacoId,
          data,
          horario,
          status: 'DISPONIVEL', // DISPONIVEL | RESERVADO | BLOQUEADO
          prof: '',
          turma: ''
        };
        await kv.set(`espaco:${espacoId}`, slot);
        return res.status(200).json({ mensagem: 'Horário liberado na agenda!', slot });
      }

      // 6. Bibliotecária: Bloquear Horário Indisponível (Exige PIN)
      if (acao === 'bloquear_horario') {
        if (pin !== PIN_CORRETO) {
          return res.status(403).json({ erro: 'PIN da bibliotecária incorreto!' });
        }
        const espacoId = Date.now().toString();
        const slot = {
          id: espacoId,
          data,
          horario,
          status: 'BLOQUEADO',
          motivo: req.body.motivo || 'Indisponível / Uso Interno'
        };
        await kv.set(`espaco:${espacoId}`, slot);
        return res.status(200).json({ mensagem: 'Horário marcado como indisponível!', slot });
      }

      // 7. Professor: Reservar um Horário previamente Liberado pela Biblioteca
      if (acao === 'reservar_slot') {
        const espacoKey = `espaco:${id}`;
        const slot = await kv.get(espacoKey);
        if (!slot || slot.status !== 'DISPONIVEL') {
          return res.status(400).json({ erro: 'Este horário não está mais disponível.' });
        }
        slot.status = 'RESERVADO';
        slot.prof = prof;
        slot.turma = turma;
        await kv.set(espacoKey, slot);
        return res.status(200).json({ mensagem: 'Reserva confirmada!', slot });
      }

      // 8. Excluir Item (Livro, Aluno ou Horário do Espaço) — Protegido por PIN
      if (acao === 'excluir') {
        if (pin !== PIN_CORRETO) {
          return res.status(403).json({ erro: 'PIN incorreto! Exclusão não autorizada.' });
        }
        await kv.del(`${tipoItem}:${itemId}`);
        return res.status(200).json({ mensagem: 'Registro excluído com sucesso!' });
      }

      return res.status(400).json({ erro: 'Ação inválida' });
    }

    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
