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
            throw new Error("Credenciais não configuradas.");
        }

        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);

        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
        const linhas = await abaAgendamentos.getRows();

        if (event.httpMethod === 'GET') {
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        }

        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);

            if (dados.action) {
                const { action, id } = dados;
                const linhaParaAtualizar = linhas.find(row => row.get('ID_Agendamento') === id);

                if (linhaParaAtualizar) {
                    const agendamento = linhaParaAtualizar.toObject();
                    if (action === 'aprovar') {
                        linhaParaAtualizar.set('Status', 'Aprovado');
                        await linhaParaAtualizar.save();
                        await enviarEmailDeAprovacao(agendamento);
                        await criarEventoNaAgenda(agendamento, auth, EMAIL_USER);
                    } else if (action === 'recusar') {
                        linhaParaAtualizar.set('Status', 'Recusado');
                        await linhaParaAtualizar.save();
                        await enviarEmailDeRecusa(agendamento);
                    }
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
                }
            } else {
                const novaLinha = { ID_Agendamento: `visita-${new Date().getTime()}`, Data_Solicitacao: new Date().toISOString(), Status: "Pendente", ...dados };
                await abaAgendamentos.addRow(novaLinha);
                await enviarEmailParaAdmin(dados);
                await enviarEmailParaVisitante(dados);
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
            }
        }
    } catch (error) {
        console.error("Erro na função Netlify:", error.toString());
        return { statusCode: 500, body: JSON.stringify({ status: "erro", message: error.toString() }) };
    }
};

async function criarEventoNaAgenda(agendamento, auth, calendarId) {
    const calendar = google.calendar({ version: 'v3', auth });
    const dataVisita = new Date(`${agendamento.Data_Visita}T00:00:00-03:00`);
    const horaInicio = agendamento.Periodo === 'Matutino' ? '09:00:00' : '14:00:00';
    const horaFim = agendamento.Periodo === 'Matutino' ? '11:30:00' : '16:30:00';
    const dataInicioISO = `${dataVisita.toISOString().split('T')[0]}T${horaInicio}-03:00`;
    const dataFimISO = `${dataVisita.toISOString().split('T')[0]}T${horaFim}-03:00`;

    await calendar.events.insert({
        calendarId: calendarId, sendNotifications: true,
        requestBody: {
            summary: `Visita: ${agendamento.Nome_Escola}`,
            description: `Responsável: ${agendamento.Nome_Responsavel}\nAlunos: ${agendamento.Qtd_Alunos}\nObjetivo: ${agendamento.Objetivo_Visita}`,
            start: { dateTime: dataInicioISO, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: dataFimISO, timeZone: 'America/Sao_Paulo' },
            attendees: [{ email: agendamento.Email_Responsavel }],
        },
    });
}

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });

async function enviarEmailParaAdmin(dados) {
    await transporter.sendMail({
        from: `"Agenda IFC Concórdia" <${EMAIL_USER}>`, to: "extensao.concordia@ifc.edu.br", subject: `Nova Solicitação: ${dados.nomeEscola}`,
        html: `<p>Nova solicitação recebida de ${dados.nomeEscola} para ${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}.</p>`,
    });
}

async function enviarEmailParaVisitante(dados) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão" <${EMAIL_USER}>`, to: dados.emailResponsavel, subject: `Recebemos sua solicitação de visita!`,
        html: `<p>Olá, ${dados.nomeResponsavel},</p><p>Recebemos sua solicitação para o dia <strong>${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong> e estamos analisando.</p>`,
    });
}

async function enviarEmailDeAprovacao(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: `✅ Agendamento Confirmado!`,
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Sua visita para o dia <strong>${new Date(agendamento.Data_Visita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong> foi <strong>APROVADA</strong>.</p><p>Um convite foi enviado para sua agenda.</p>`,
    });
}

async function enviarEmailDeRecusa(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: `Sobre sua solicitação de visita`,
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Infelizmente, não poderemos confirmar seu agendamento para a data solicitada. Por favor, tente uma nova data em nosso site.</p>`,
    });
}
