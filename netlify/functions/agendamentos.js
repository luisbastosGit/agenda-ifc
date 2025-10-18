const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
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
        if (!credenciaisBase64 || !EMAIL_USER || !EMAIL_PASS) {
            throw new Error("Credenciais do Google ou de E-mail não foram encontradas.");
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

        if (event.httpMethod === 'GET') {
            const linhas = await abaAgendamentos.getRows();
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        }

        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);
            const novaLinha = { 
                ID_Agendamento: "visita-" + new Date().getTime(), 
                Data_Solicitacao: new Date().toISOString(), 
                Status: "Pendente", 
                ...dados
            };
            await abaAgendamentos.addRow(novaLinha);

            // Dispara os e-mails de notificação
            await enviarEmailParaAdmin(dados);
            await enviarEmailParaVisitante(dados);

            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", message: "Agendamento recebido!" }) };
        }

    } catch (error) {
        console.error("Erro na função Netlify:", error.toString());
        return {
            statusCode: 500,
            body: JSON.stringify({ status: "erro", message: error.toString() })
        };
    }
};

// Função para enviar e-mail para a Coordenação de Extensão
async function enviarEmailParaAdmin(dados) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });

    await transporter.sendMail({
        from: `"Agenda IFC Concórdia" <${EMAIL_USER}>`,
        to: "extensao.concordia@ifc.edu.br",
        subject: `Nova Solicitação de Visita: ${dados.nomeEscola}`,
        html: `
            <p>Uma nova solicitação de agendamento de visita foi recebida através do site.</p>
            <h3>Detalhes:</h3>
            <ul>
                <li><strong>Escola:</strong> ${dados.nomeEscola}</li>
                <li><strong>Data da Visita:</strong> ${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</li>
                <li><strong>Período:</strong> ${dados.periodo}</li>
                <li><strong>Responsável:</strong> ${dados.nomeResponsavel}</li>
                <li><strong>Contato:</strong> ${dados.emailResponsavel}</li>
            </ul>
            <p>O agendamento foi registrado na planilha e está aguardando aprovação no painel de gestão.</p>
        `,
    });
}

// Função para enviar e-mail de confirmação para o visitante
async function enviarEmailParaVisitante(dados) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });

    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`,
        to: dados.emailResponsavel,
        subject: "Recebemos sua solicitação de agendamento de visita!",
        html: `
            <p>Olá, ${dados.nomeResponsavel},</p>
            <p>Recebemos com sucesso sua solicitação de agendamento de visita ao campus do IFC Concórdia para o dia <strong>${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>, no período ${dados.periodo}.</p>
            <p>Sua solicitação está sendo analisada pela nossa equipe. Em breve, você receberá um novo e-mail com a confirmação e mais detalhes sobre a visita.</p>
            <p>Qualquer dúvida, você pode entrar em contato conosco através deste e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p>
            <p>Agradecemos o seu interesse!</p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Coordenação de Extensão, Ensino, Estágios e Egressos</strong><br>
            IFC Campus Concórdia</p>
        `,
    });
}
