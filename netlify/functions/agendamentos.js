/*
CHECK v1.3 (20/10/2025):
- Funcionalidades v1.2 preservadas.
- ALTERAÇÃO PONTUAL: Rota GET e Ação Login agora formatam as datas ('Data_Visita', 'Data_Solicitacao') para AAAA-MM-DD ANTES de enviar a resposta JSON. Isso padroniza a saída e simplifica o frontend.
- Código completo, sem omissões. Destaques adicionados.
*/
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI"; 
const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- Funções Auxiliares de Formatação ---
function converterDataParaISO(dataDDMMYYYY) {
    if (!dataDDMMYYYY || typeof dataDDMMYYYY !== 'string') return null;
    const partes = dataDDMMYYYY.split('/');
    if (partes.length !== 3) return null;
    const [dia, mes, ano] = partes;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}
function formatarDataParaISO(dataInput) {
    if (!dataInput) return null;
    try {
        if (typeof dataInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dataInput)) return dataInput; 
        if (dataInput instanceof Date) {
            const dataAjustada = new Date(dataInput.getTime() + dataInput.getTimezoneOffset() * 60000);
            return dataAjustada.toISOString().split('T')[0];
        }
        if (typeof dataInput === 'string' && dataInput.includes('/')) return converterDataParaISO(dataInput); 
    } catch (e) { /* Ignora erros */ }
    console.warn("Formato de data inesperado:", dataInput); 
    return null; 
}
// --- Fim Funções Auxiliares de Formatação ---

exports.handler = async (event, context) => {
    try {
        if (!credenciaisBase64 || !ID_PLANILHA) { throw new Error("Credenciais ou ID da planilha não configurados."); }
        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);
        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo(); 

        // ================= ROTA GET =================
        if (event.httpMethod === 'GET') {
            console.log("Iniciando busca de datas indisponíveis (GET)...");
            let datasOcupadas = [], datasBloqueadas = [];
            try {
                const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
                if (abaAgendamentos && abaAgendamentos.rowCount > 1) { 
                    const linhasAgendamentos = await abaAgendamentos.getRows();
                    datasOcupadas = linhasAgendamentos.filter(l => l.get('Status') === 'Pendente' || l.get('Status') === 'Aprovado').map(l => formatarDataParaISO(l.get('Data_Visita'))).filter(d => d);
                }
            } catch (err) { console.error("Erro GET - Leitura Agendamentos:", err.toString()); }
            try {
                const abaBloqueios = doc.sheetsByTitle['Bloqueios'];
                if (abaBloqueios && abaBloqueios.rowCount > 1) { 
                    const linhasBloqueios = await abaBloqueios.getRows();
                    datasBloqueadas = linhasBloqueios.map(l => formatarDataParaISO(l.get('Data_Bloqueada'))).filter(d => d);
                }
            } catch (err) { console.warn("Aviso GET - Leitura Bloqueios:", err.toString()); }
            const todasDatasIndisponiveis = [...new Set([...datasOcupadas, ...datasBloqueadas])];
            console.log("Datas indisponíveis combinadas:", todasDatasIndisponiveis); 
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", datas: todasDatasIndisponiveis }) };
        }
        
        // ================= ROTA POST =================
        if (event.httpMethod === 'POST') {
             const abaAgendamentos = doc.sheetsByTitle['Agendamentos']; 
             if (!abaAgendamentos) throw new Error("Aba 'Agendamentos' não encontrada na planilha."); 
             const dados = JSON.parse(event.body);
             console.log("Handler POST: Recebida ação:", dados.action || 'Novo Agendamento'); 

            // --- AÇÃO LOGIN ---
            if (dados.action === 'login') { 
                if (dados.password !== ADMIN_PASSWORD) { 
                    console.warn("Handler POST - Tentativa de login com senha incorreta.");
                    return { statusCode: 401, body: JSON.stringify({ status: "erro", message: "Senha incorreta." }) }; 
                }
                const linhas = await abaAgendamentos.getRows(); 
                // ***** ALTERAÇÃO PONTUAL v1.3 *****
                // Formata as datas ANTES de enviar para o frontend
                const agendamentos = linhas.map(linha => {
                    const obj = linha.toObject();
                    obj.Data_Visita = formatarDataParaISO(obj.Data_Visita); 
                    obj.Data_Solicitacao = formatarDataParaISO(obj.Data_Solicitacao);
                    obj.Data_Resposta = formatarDataParaISO(obj.Data_Resposta);
                    return obj;
                });
                // ***** FIM DA ALTERAÇÃO PONTUAL v1.3 *****
                console.log("Handler POST - Login bem-sucedido.");
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
            } 
            
            // --- AÇÕES APROVAR/RECUSAR ---
            else if (dados.action === 'aprovar' || dados.action === 'recusar') { 
                if (dados.password !== ADMIN_PASSWORD) return { statusCode: 401, body: JSON.stringify({ status: "erro", message: "Não autorizado." }) };
                const linhas = await abaAgendamentos.getRows(); 
                const linhaParaAtualizar = linhas.find(row => row.get('ID_Agendamento') === dados.id);
                if (linhaParaAtualizar) {
                    const agendamento = linhaParaAtualizar.toObject();
                    const novoStatus = dados.action === 'aprovar' ? 'Aprovado' : 'Recusado';
                    linhaParaAtualizar.set('Status', novoStatus);
                    linhaParaAtualizar.set('Data_Resposta', new Date().toISOString().split('T')[0]); // Salva como AAAA-MM-DD
                    await linhaParaAtualizar.save();
                    console.log(`Handler POST - Status do ID ${dados.id} atualizado para ${novoStatus}.`);

                    if (dados.action === 'aprovar') {
                        await enviarEmailDeAprovacao(agendamento);
                        await criarEventoNaAgenda(agendamento, auth, EMAIL_USER);
                    } else {
                        await enviarEmailDeRecusa(agendamento);
                    }
                    await enviarEmailDeConfirmacaoParaAdmin(agendamento, novoStatus.toUpperCase());
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
                } else {
                     console.error(`Handler POST - Agendamento ID ${dados.id} não encontrado para ${dados.action}.`);
                     throw new Error(`Agendamento não encontrado.`);
                }
             } 
             
            // --- NOVO AGENDAMENTO ---
            else { 
                const linhas = await abaAgendamentos.getRows(); 
                const agendamentoPendenteExistente = linhas.find(row => (row.get('Nome_Escola') || '').toLowerCase() === dados.nomeEscola.toLowerCase() && row.get('Status') === 'Pendente');
                if (agendamentoPendenteExistente) { 
                    console.warn(`Handler POST - Agendamento pendente já existe para ${dados.nomeEscola}.`);
                    return { statusCode: 400, body: JSON.stringify({ status: "erro", message: "Sua escola já possui um agendamento pendente." }) }; 
                }
                // Garante que a Data_Visita seja salva como AAAA-MM-DD
                const dataVisitaFormatada = formatarDataParaISO(dados.dataVisita); 
                if (!dataVisitaFormatada) throw new Error("Formato inválido para Data da Visita recebida.");

                const novaLinha = { 
                    ID_Agendamento: `visita-${new Date().getTime()}`, Data_Solicitacao: new Date().toISOString(), Status: "Pendente",
                    Data_Visita: dataVisitaFormatada, // Usa a data formatada
                    Periodo: dados.periodo, Nome_Escola: dados.nomeEscola, Cidade_Escola: dados.cidadeEscola,
                    Nome_Responsavel: dados.nomeResponsavel, Telefone_Responsavel: dados.telefoneResponsavel, Email_Responsavel: dados.emailResponsavel,
                    Qtd_Alunos: dados.qtdAlunos, Faixa_Etaria: dados.faixaEtaria, Ano_Letivo: dados.anoLetivo,
                    Objetivo_Visita: dados.objetivoVisita, Pretende_Almocar: dados.pretendeAlmocar, Observacoes: dados.observacoes
                };
                await abaAgendamentos.addRow(novaLinha);
                console.log(`Handler POST - Novo agendamento criado para ${dados.nomeEscola}.`);
                // Envia os dados originais (que contêm dataVisita no formato esperado pelo email)
                await enviarEmailParaAdmin(dados); 
                await enviarEmailParaVisitante(dados); 
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
            }
        }
    } catch (error) {
        console.error("Erro FATAL na função Netlify:", error.toString());
        return { statusCode: 500, body: JSON.stringify({ status: "erro", message: error.toString() }) };
    }
};

// --- Funções Auxiliares Completas ---
async function criarEventoNaAgenda(agendamento, auth, calendarId) {
    const calendar = google.calendar({ version: 'v3', auth });
    const dataVisitaInput = agendamento.Data_Visita;
    if (!dataVisitaInput) { console.error("Agenda: Data da Visita inválida:", agendamento.ID_Agendamento); return; }
    const dataVisitaISO = formatarDataParaISO(dataVisitaInput); 
    if (!dataVisitaISO) { console.error("Agenda: Não foi possível formatar Data da Visita:", agendamento.ID_Agendamento, dataVisitaInput); return; }
    const dataVisita = new Date(`${dataVisitaISO}T00:00:00-03:00`);
    if (isNaN(dataVisita.getTime())) { console.error("Agenda: Data da Visita inválida após conversão final:", agendamento.ID_Agendamento, dataVisitaISO); return; }

    const horaInicio = agendamento.Periodo === 'Matutino' ? '09:00:00' : '14:00:00';
    const horaFim = agendamento.Periodo === 'Matutino' ? '11:30:00' : '16:30:00';
    try {
        const dataInicioISO = `${dataVisitaISO}T${horaInicio}-03:00`;
        const dataFimISO = `${dataVisitaISO}T${horaFim}-03:00`;
        await calendar.events.insert({
            calendarId: calendarId,
            requestBody: {
                summary: `Visita: ${agendamento.Nome_Escola || 'Escola não informada'}`,
                description: `Responsável: ${agendamento.Nome_Responsavel || '-'}\nContato: ${agendamento.Email_Responsavel || '-'}\nAlunos: ${agendamento.Qtd_Alunos || '-'}\nObjetivo: ${agendamento.Objetivo_Visita || '-'}`,
                start: { dateTime: dataInicioISO, timeZone: 'America/Sao_Paulo' },
                end: { dateTime: dataFimISO, timeZone: 'America/Sao_Paulo' },
            },
        });
        console.log("Agenda: Evento criado para:", agendamento.ID_Agendamento);
    } catch (calendarError) {
        console.error("Agenda: Erro ao criar evento:", agendamento.ID_Agendamento, calendarError.toString());
    }
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
