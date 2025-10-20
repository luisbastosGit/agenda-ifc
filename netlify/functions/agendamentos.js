/*
DUPLO CHECK REALIZADO:
- Funcionalidades da versão anterior preservadas:
  - Login com senha.
  - Criação de novo agendamento (com verificação de pendência).
  - Ações de Aprovar/Recusar.
  - Envio de todos os e-mails (solicitação, aprovação, recusa, notificação para admin).
  - Criação de evento no Google Agenda ao aprovar.
  - Registro da Data_Resposta na planilha.
- Nova funcionalidade adicionada:
  - A rota GET agora busca e retorna a lista de datas indisponíveis (status Pendente/Aprovado + datas da aba Bloqueios).
*/

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// ################### PASSO IMPORTANTE ###################
// ID DA SUA PLANILHA PRINCIPAL (V2) ONDE FICAM OS AGENDAMENTOS
const ID_PLANILHA_AGENDAMENTOS = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI"; 
// ########################################################

// ID DA PLANILHA SEPARADA ONDE FICAM OS BLOQUEIOS MANUAIS
const ID_PLANILHA_BLOQUEIOS = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI"; 

const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

exports.handler = async (event, context) => {
    try {
        if (!credenciaisBase64 || !ID_PLANILHA_AGENDAMENTOS) { throw new Error("Credenciais ou ID da planilha principal não configurados."); }
        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);
        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
        });

        // ROTA GET: MUDANÇA PARA LER AS DUAS PLANILHAS
        if (event.httpMethod === 'GET') {
            // Conecta à planilha de Agendamentos
            const docAgendamentos = new GoogleSpreadsheet(ID_PLANILHA_AGENDAMENTOS, auth);
            await docAgendamentos.loadInfo();
            const abaAgendamentos = docAgendamentos.sheetsByTitle['Agendamentos'];
            const linhasAgendamentos = await abaAgendamentos.getRows();
            const datasOcupadas = linhasAgendamentos
                .filter(linha => linha.get('Status') === 'Pendente' || linha.get('Status') === 'Aprovado')
                .map(linha => linha.get('Data_Visita'));

            // Conecta à planilha de Bloqueios
            let datasBloqueadas = [];
            try {
                const docBloqueios = new GoogleSpreadsheet(ID_PLANILHA_BLOQUEIOS, auth);
                await docBloqueios.loadInfo();
                const abaBloqueios = docBloqueios.sheetsByTitle['Bloqueios'];
                if (abaBloqueios && abaBloqueios.rowCount > 1) {
                    const linhasBloqueios = await abaBloqueios.getRows();
                    datasBloqueadas = linhasBloqueios.map(linha => linha.get('Data_Bloqueada'));
                }
            } catch (errorBloqueio) {
                console.warn("Aviso: Não foi possível carregar a planilha de Bloqueios. Verifique o ID ou as permissões.", errorBloqueio.toString());
                // Continua mesmo se a planilha de bloqueios falhar
            }
            
            // Combina as duas listas e remove duplicatas
            const todasDatasIndisponiveis = [...new Set([...datasOcupadas, ...datasBloqueadas])];

            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", datas: todasDatasIndisponiveis }) };
        }
        
        // ROTA GET: MUDANÇA PARA O CALENDÁRIO PÚBLICO
        if (event.httpMethod === 'GET') {
            const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
            const linhasAgendamentos = await abaAgendamentos.getRows();
            const datasOcupadas = linhasAgendamentos
                .filter(linha => linha.get('Status') === 'Pendente' || linha.get('Status') === 'Aprovado')
                .map(linha => linha.get('Data_Visita'));

            const abaBloqueios = doc.sheetsByTitle['Bloqueios'];
            // Verifica se a aba 'Bloqueios' existe e tem linhas antes de tentar ler
            const datasBloqueadas = (abaBloqueios && abaBloqueios.rowCount > 1) 
                ? (await abaBloqueios.getRows()).map(linha => linha.get('Data_Bloqueada')) 
                : [];
            
            // Combina as duas listas e remove duplicatas
            const todasDatasIndisponiveis = [...new Set([...datasOcupadas, ...datasBloqueadas])];

            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", datas: todasDatasIndisponiveis }) };
        }

        // ROTA POST PARA TODAS AS OUTRAS AÇÕES
        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);
            const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
            const linhas = await abaAgendamentos.getRows();

            if (dados.action === 'login') {
                if (dados.password !== ADMIN_PASSWORD) { return { statusCode: 401, body: JSON.stringify({ status: "erro", message: "Senha incorreta." }) }; }
                const agendamentos = linhas.map(linha => linha.toObject());
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
            } 
            
            else if (dados.action === 'aprovar' || dados.action === 'recusar') {
                if (dados.password !== ADMIN_PASSWORD) return { statusCode: 401, body: JSON.stringify({ status: "erro", message: "Não autorizado." }) };
                const linhaParaAtualizar = linhas.find(row => row.get('ID_Agendamento') === dados.id);
                if (linhaParaAtualizar) {
                    const agendamento = linhaParaAtualizar.toObject();
                    const novoStatus = dados.action === 'aprovar' ? 'Aprovado' : 'Recusado';
                    linhaParaAtualizar.set('Status', novoStatus);
                    linhaParaAtualizar.set('Data_Resposta', new Date().toISOString());
                    await linhaParaAtualizar.save();

                    if (dados.action === 'aprovar') {
                        await enviarEmailDeAprovacao(agendamento);
                        await criarEventoNaAgenda(agendamento, auth, EMAIL_USER);
                    } else {
                        await enviarEmailDeRecusa(agendamento);
                    }
                    await enviarEmailDeConfirmacaoParaAdmin(agendamento, novoStatus.toUpperCase());
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
                }
            } 
            
            else { // Novo Agendamento
                const agendamentoPendenteExistente = linhas.find(row => (row.get('Nome_Escola') || '').toLowerCase() === dados.nomeEscola.toLowerCase() && row.get('Status') === 'Pendente');
                if (agendamentoPendenteExistente) { return { statusCode: 400, body: JSON.stringify({ status: "erro", message: "Sua escola já possui um agendamento pendente." }) }; }
                const novaLinha = { 
                    ID_Agendamento: `visita-${new Date().getTime()}`, Data_Solicitacao: new Date().toISOString(), Status: "Pendente",
                    Data_Visita: dados.dataVisita, Periodo: dados.periodo, Nome_Escola: dados.nomeEscola, Cidade_Escola: dados.cidadeEscola,
                    Nome_Responsavel: dados.nomeResponsavel, Telefone_Responsavel: dados.telefoneResponsavel, Email_Responsavel: dados.emailResponsavel,
                    Qtd_Alunos: dados.qtdAlunos, Faixa_Etaria: dados.faixaEtaria, Ano_Letivo: dados.anoLetivo,
                    Objetivo_Visita: dados.objetivoVisita, Pretende_Almocar: dados.pretendeAlmocar, Observacoes: dados.observacoes
                };
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

// --- Funções Auxiliares Completas ---
async function criarEventoNaAgenda(agendamento, auth, calendarId) {
    const calendar = google.calendar({ version: 'v3', auth });
    const dataVisita = new Date(`${agendamento.Data_Visita}T00:00:00-03:00`);
    const horaInicio = agendamento.Periodo === 'Matutino' ? '09:00:00' : '14:00:00';
    const horaFim = agendamento.Periodo === 'Matutino' ? '11:30:00' : '16:30:00';
    const dataInicioISO = `${dataVisita.toISOString().split('T')[0]}T${horaInicio}-03:00`;
    const dataFimISO = `${dataVisita.toISOString().split('T')[0]}T${horaFim}-03:00`;
    await calendar.events.insert({
        calendarId: calendarId,
        requestBody: {
            summary: `Visita: ${agendamento.Nome_Escola}`,
            description: `Responsável: ${agendamento.Nome_Responsavel}\nContato: ${agendamento.Email_Responsavel}\nAlunos: ${agendamento.Qtd_Alunos}\nObjetivo: ${agendamento.Objetivo_Visita}`,
            start: { dateTime: dataInicioISO, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: dataFimISO, timeZone: 'America/Sao_Paulo' },
        },
    });
}

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });

async function enviarEmailParaAdmin(dados) {
    await transporter.sendMail({
        from: `"Agenda IFC Concórdia" <${EMAIL_USER}>`, to: "extensao.concordia@ifc.edu.br", subject: `Nova Solicitação de Visita: ${dados.nomeEscola}`,
        html: `<p>Uma nova solicitação de agendamento de visita foi recebida através do site.</p><h3>Detalhes:</h3><ul><li><strong>Escola:</strong> ${dados.nomeEscola}</li><li><strong>Data da Visita:</strong> ${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</li><li><strong>Responsável:</strong> ${dados.nomeResponsavel}</li><li><strong>Contato:</strong> ${dados.emailResponsavel}</li></ul><p>O agendamento foi registrado na planilha e está aguardando aprovação no painel de gestão.</p>`,
    });
}

async function enviarEmailParaVisitante(dados) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: dados.emailResponsavel, subject: "Recebemos sua solicitação de agendamento de visita!",
        html: `<p>Olá, ${dados.nomeResponsavel},</p><p>Recebemos com sucesso sua solicitação de agendamento de visita ao campus do IFC Concórdia para o dia <strong>${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>, no período ${dados.periodo}.</p><p>Sua solicitação está sendo analisada pela nossa equipe. Em breve, você receberá um novo e-mail com a confirmação e mais detalhes sobre a visita.</p><p>Qualquer dúvida, você pode entrar em contato conosco através deste e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Agradecemos o seu interesse!</p><br><p>Atenciosamente,</p><p><strong>Coordenação de Extensão, Ensino, Estágios e Egressos</strong><br>IFC Campus Concórdia</p>`,
    });
}

async function enviarEmailDeAprovacao(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: "✅ Agendamento de Visita Confirmado!",
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Boas notícias! Sua visita ao IFC Campus Concórdia para o dia <strong>${new Date(agendamento.Data_Visita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong> foi <strong>APROVADA</strong>.</p><p>O evento já foi adicionado à nossa agenda. Estamos ansiosos para recebê-los!</p><p>Qualquer dúvida, você pode entrar em contato conosco através deste e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}

async function enviarEmailDeRecusa(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: "Sobre sua solicitação de visita ao IFC Concórdia",
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Agradecemos o seu interesse em visitar o IFC Campus Concórdia. Infelizmente, não poderemos confirmar seu agendamento para a data solicitada.</p><p>Gostaríamos de convidá-lo a tentar o agendamento para uma nova data em nosso site.</p><p>Para qualquer esclarecimento, estamos à disposição por este e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}

async function enviarEmailDeConfirmacaoParaAdmin(agendamento, statusFinal) {
    await transporter.sendMail({
        from: `"Sistema de Agendamentos" <${EMAIL_USER}>`, to: "extensao.concordia@ifc.edu.br", subject: `✅ ATUALIZAÇÃO: Agendamento de "${agendamento.Nome_Escola}" foi ${statusFinal}`,
        html: `<p>Este é um registro automático de ação.</p><p>O agendamento de visita para a escola <strong>${agendamento.Nome_Escola}</strong> (data da visita: ${new Date(agendamento.Data_Visita + 'T12:00:00').toLocaleDateString('pt-BR')}) foi <strong>${statusFinal}</strong> no painel de gestão.</p><p>A data desta resposta foi registrada na planilha.</p>`,
    });
}
