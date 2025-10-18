const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const nodemailer = require('nodemailer');

// ################### PASSO IMPORTANTE ###################
// COLE O ID DA SUA PLANILHA V2 DENTRO DAS ASPAS ABAIXO
const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI";
// ########################################################

const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

exports.handler = async (event, context) => {
    console.log("Iniciando verificação de lembretes agendados...");

    try {
        if (!credenciaisBase64 || !EMAIL_USER || !EMAIL_PASS) {
            throw new Error("Credenciais não configuradas corretamente.");
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

        const hoje = new Date();
        const doisDiasEmMs = 2 * 24 * 60 * 60 * 1000;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        });

        // Loop para verificar cada agendamento na planilha
        for (const linha of linhas) {
            const agendamento = linha.toObject();
            const dataVisita = new Date(agendamento.Data_Visita + 'T12:00:00');
            const dataSolicitacao = new Date(agendamento.Data_Solicitacao);

            // 1. VERIFICA LEMBRETE PARA CLIENTE (EVENTO APROVADO EM 48H)
            if (agendamento.Status === 'Aprovado') {
                const diffTempo = dataVisita.getTime() - hoje.getTime();
                if (diffTempo > 0 && diffTempo <= doisDiasEmMs) {
                    console.log(`Enviando lembrete de visita para ${agendamento.Email_Responsavel}`);
                    await transporter.sendMail({
                        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`,
                        to: agendamento.Email_Responsavel,
                        subject: "Lembrete da sua visita ao IFC Concórdia",
                        html: `
                            <p>Olá, ${agendamento.Nome_Responsavel},</p>
                            <p>Este é um lembrete amigável sobre sua visita agendada ao nosso campus em <strong>${dataVisita.toLocaleDateString('pt-BR')}</strong>.</p>
                            <p>Estamos ansiosos para recebê-los! Caso tenha algum imprevisto e precise cancelar, por favor, nos informe respondendo a este e-mail.</p>
                            <p>Atenciosamente,<br>Coordenação de Extensão</p>
                        `,
                    });
                }
            }

            // 2. VERIFICA LEMBRETE PARA COORDENAÇÃO (PENDENTE HÁ MAIS DE 2 DIAS)
            if (agendamento.Status === 'Pendente') {
                const diffTempo = hoje.getTime() - dataSolicitacao.getTime();
                if (diffTempo > doisDiasEmMs) {
                    console.log(`Enviando lembrete de pendência para a Coordenação sobre ${agendamento.Nome_Escola}`);
                    await transporter.sendMail({
                        from: `"Sistema de Agendamentos" <${EMAIL_USER}>`,
                        to: "extensao.concordia@ifc.edu.br",
                        subject: `LEMBRETE: Agendamento de "${agendamento.Nome_Escola}" está pendente`,
                        html: `
                            <p>Este é um lembrete automático.</p>
                            <p>A solicitação de visita da escola <strong>${agendamento.Nome_Escola}</strong> (para a data ${new Date(agendamento.Data_Visita + 'T12:00:00').toLocaleDateString('pt-BR')}) está com o status "Pendente" há mais de 48 horas.</p>
                            <p>Por favor, acesse o painel de gestão para aprovar ou recusar a solicitação.</p>
                        `,
                    });
                }
            }
        }

        console.log("Verificação de lembretes concluída.");
        return {
            statusCode: 200,
            body: "Verificação de lembretes executada com sucesso.",
        };

    } catch (error) {
        console.error("Erro na função de lembretes agendados:", error.toString());
        return {
            statusCode: 500,
            body: error.toString(),
        };
    }
};