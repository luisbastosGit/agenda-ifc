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
                        await enviarEmailDeAprovacao(agendamento); // Envia e-mail de aprovação
                    } else if (action === 'recusar') {
                        linhaParaAtualizar.set('Status', 'Recusado');
                        await linhaParaAtualizar.save();
                        await enviarEmailDeRecusa(agendamento); // Envia e-mail de recusa
                    }
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso", message: `Status atualizado` }) };
                } else {
                    throw new Error(`Agendamento com ID ${id} não encontrado.`);
                }
            } 
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

// --- FUNÇÕES DE E-MAIL ---

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

async function enviarEmailParaAdmin(dados) {
    await transporter.sendMail({
        from: `"Agenda IFC Concórdia" <${EMAIL_USER}>`, to: "extensao.concordia@ifc.edu.br", subject: `Nova Solicitação de Visita: ${dados.nomeEscola}`,
        html: `<p>Nova solicitação de agendamento recebida de ${dados.nomeEscola} para ${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}.</p><p>Aguardando aprovação no painel.</p>`,
    });
}

async function enviarEmailParaVisitante(dados) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: dados.emailResponsavel, subject: "Recebemos sua solicitação de agendamento!",
        html: `<p>Olá, ${dados.nomeResponsavel},</p><p>Recebemos sua solicitação para o dia <strong>${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>.</p><p>Sua solicitação está em análise e em breve você receberá a confirmação.</p><p>Dúvidas: (49) 3341-4819.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}

async function enviarEmailDeAprovacao(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: "✅ Agendamento de Visita Confirmado!",
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Boas notícias! Sua visita ao IFC Campus Concórdia para o dia <strong>${new Date(agendamento.Data_Visita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong> foi <strong>APROVADA</strong>.</p><p>Estamos ansiosos para recebê-los!</p><p>Qualquer dúvida, você pode entrar em contato conosco através deste e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}

async function enviarEmailDeRecusa(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: "Sobre sua solicitação de visita ao IFC Concórdia",
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Agradecemos o seu interesse em visitar o IFC Campus Concórdia. Infelizmente, não poderemos confirmar seu agendamento para a data solicitada.</p><p>Gostaríamos de convidá-lo a tentar o agendamento para uma nova data em nosso site.</p><p>Para qualquer esclarecimento, estamos à disposição por este e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}
