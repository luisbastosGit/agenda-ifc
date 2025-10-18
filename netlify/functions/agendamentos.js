const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// ################### PASSO IMPORTANTE ###################
// CONFIRME SE O ID DA SUA PLANILHA V2 ESTÁ CORRETO
const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI";
// ########################################################

const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

exports.handler = async (event, context) => {
    try {
        if (!credenciaisBase64 || !ID_PLANILHA || !EMAIL_USER || !EMAIL_PASS) {
            throw new Error("Credenciais não configuradas corretamente.");
        }

        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);

        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/calendar'
            ],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
        const linhas = await abaAgendamentos.getRows();

        // Rota GET: Listar todos os agendamentos para o painel
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
                    const agendamento = linhaParaAtualizar.toObject();
                    if (action === 'aprovar') {
                        linhaParaAtualizar.set('Status', 'Aprovado');
                        linhaParaAtualizar.set('Data_Resposta', new Date().toISOString()); // Registra a data da resposta
                        await linhaParaAtualizar.save();
                        await enviarEmailDeAprovacao(agendamento);
                        await criarEventoNaAgenda(agendamento, auth, EMAIL_USER);
                        await enviarEmailDeConfirmacaoParaAdmin(agendamento, "APROVADO"); // Notifica a coordenação
                    } else if (action === 'recusar') {
                        linhaParaAtualizar.set('Status', 'Recusado');
                        linhaParaAtualizar.set('Data_Resposta', new Date().toISOString()); // Registra a data da resposta
                        await linhaParaAtualizar.save();
                        await enviarEmailDeRecusa(agendamento);
                        await enviarEmailDeConfirmacaoParaAdmin(agendamento, "RECUSADO"); // Notifica a coordenação
                    }
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
                }
            } 
            // Se for um NOVO agendamento do formulário público
            else {
                const novaLinha = { 
                    ID_Agendamento: `visita-${new Date().getTime()}`, 
                    Data_Solicitacao: new Date().toISOString(), 
                    Status: "Pendente", 
                    ...dados 
                };
