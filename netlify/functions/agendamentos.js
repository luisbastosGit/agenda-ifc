const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const nodemailer = require('nodemailer');

const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI";
const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

exports.handler = async (event, context) => {
    try {
        if (!credenciaisBase64 || !ID_PLANILHA) {
            throw new Error("Credenciais ou ID da planilha não encontrados.");
        }

        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);

        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
        const linhas = await abaAgendamentos.getRows();

        // Rota GET: Listar todos os agendamentos
        if (event.httpMethod === 'GET') {
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        }

        // Rota POST: Adicionar novo agendamento OU atualizar um existente
        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);

            // Se for uma AÇÃO do painel de admin (aprovar/recusar)
            if (dados.action) {
                const { action, id } = dados;
                const linhaParaAtualizar = linhas.find(row => row.get('ID_Agendamento') === id);

                if (linhaParaAtualizar) {
                    if (action === 'aprovar') {
                        linhaParaAtualizar.set('Status', 'Aprovado');
                        // Futuramente: enviar e-mail de aprovação
                    } else if (action === 'recusar') {
                        linhaParaAtualizar.set('Status', 'Recusado');
                        // Futuramente: enviar e-mail de recusa
                    }
                    await linhaParaAtualizar.save();
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso", message: `Status atualizado para ${action}` }) };
                } else {
                    throw new Error(`Agendamento com ID ${id} não encontrado.`);
                }
            } 
            // Se for um NOVO agendamento do formulário público
            else {
                const novaLinha = { ID_Agendamento: "visita-" + new Date().getTime(), Data_Solicitacao: new Date().toISOString(), Status: "Pendente", ...dados };
                await abaAgendamentos.addRow(novaLinha);
                await enviarEmailParaAdmin(dados);
                await enviarEmailParaVisitante(dados);
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso", message: "Agendamento recebido!" }) };
            }
        }

    } catch (error) {
        console.error("Erro na função Netlify:", error.toString());
        return { statusCode: 500, body: JSON.stringify({ status: "erro", message: error.toString() }) };
    }
};

// Funções de e-mail (não precisam de mudança por enquanto)
async function enviarEmailParaAdmin(dados) { /* ...código do e-mail... */ }
async function enviarEmailParaVisitante(dados) { /* ...código do e-mail... */ }
