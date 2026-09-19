const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8252640362:AAGpCFxQlLV9Tmg2gZypDwz8wrFROp0eugk';
const ADMIN_CHAT_ID  = process.env.ADMIN_CHAT_ID  || '1937543186';
const JAGUAR_API_KEY = process.env.JAGUAR_API_KEY || 'jgp_live_0CEeVC2NCmErG9m4F9YS1YwDbAy299L_Av_0ceAcZIlxf0xF';
const JAGUAR_API_BASE_URL = process.env.JAGUAR_API_BASE_URL || 'https://api.jaguarpayments.com.br/v1';
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; 
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const app = express();
app.use(express.json());

const jaguarApi = axios.create({
  baseURL: JAGUAR_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${JAGUAR_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

const userStates = {};

bot.onText(/\/(start|pix)/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { step: 'AWAITING_AMOUNT' };

  bot.sendMessage(
    chatId,
    `👋 Olá, *${msg.from.first_name}*!\n\nBem-vindo à *SimPay Ltda* 💳\n\n💡 *Digite o valor do Pix que deseja gerar:*\n_(Exemplo: \`10\` ou \`25.50\`)_`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates[chatId];

  if (state && state.step === 'AWAITING_AMOUNT') {
    const amount = parseFloat(text.replace(',', '.'));

    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(
        chatId,
        '❌ *Valor inválido!* Digite um número positivo válido (Ex: `15.00`):',
        { parse_mode: 'Markdown' }
      );
    }

    delete userStates[chatId];
    bot.sendMessage(chatId, `⏳ *SimPay Ltda:* Gerando cobrança Pix no valor de *R$ ${amount.toFixed(2)}*...`, { parse_mode: 'Markdown' });

    try {
      const orderId = `SIMPAY_${Date.now()}_${chatId}`;

      const response = await jaguarApi.post('/charges', {
        external_id: orderId,
        amount: amount,
        description: `Pix SimPay Ltda - ${msg.from.first_name}`,
        webhook_url: WEBHOOK_URL,
        payer: {
          name: `${msg.from.first_name} ${msg.from.last_name || ''}`.trim(),
          email: `${chatId}@simpay.user`,
          document: '00000000000'
        }
      });

      const charge = response.data;
      const txId = charge.id;
      const pixCopiaECola = charge.pix?.copy_paste;

      await bot.sendMessage(
        chatId,
        `✅ *Cobrança SimPay Ltda Gerada!*\n\n` +
        `💵 *Valor:* R$ ${amount.toFixed(2)}\n\n` +
        `👇 *Código Pix Copia e Cola:*\n\`${pixCopiaECola}\`\n\n` +
        `_Copie o código acima e realize o pagamento no aplicativo do seu banco._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🔄 Verificar Pagamento',
                  callback_data: `check_payment_${txId}`
                }
              ]
            ]
          }
        }
      );

    } catch (error) {
      console.error('Erro ao gerar Pix:', error.response?.data || error.message);
      bot.sendMessage(chatId, '❌ Ocorreu um erro ao gerar a cobrança na SimPay Ltda. Tente novamente em instantes.');
    }
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('check_payment_')) {
    const txId = data.replace('check_payment_', '');

    bot.answerCallbackQuery(query.id, { text: 'Verificando pagamento...' });

    try {
      const response = await jaguarApi.get(`/charges/${txId}`);
      const status = response.data.status;
      const amount = response.data.amount;

      if (status === 'PAID' || status === 'COMPLETED') {
        bot.sendMessage(
          chatId,
          `🎉 *Pagamento Confirmado pela SimPay Ltda!*\n\nConfirmamos o recebimento do Pix de *R$ ${parseFloat(amount).toFixed(2)}*. Obrigado!`,
          { parse_mode: 'Markdown' }
        );
      } else {
        bot.sendMessage(
          chatId,
          `⏳ *Pagamento ainda não identificado.*\n\nSe já realizou a transferência, aguarde alguns segundos e clique novamente em verificar.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error('Erro ao verificar status:', error.response?.data || error.message);
      bot.sendMessage(chatId, '⚠️ Erro ao consultar o status no momento.');
    }
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const { status, external_id, id: txId, amount } = req.body;

    if (status === 'PAID' || status === 'COMPLETED') {
      const valorFormatado = parseFloat(amount).toFixed(2);
      const parts = external_id ? external_id.split('_') : [];
      const customerChatId = parts[2];

      if (customerChatId) {
        bot.sendMessage(
          customerChatId,
          `✅ *SimPay Ltda:* Seu Pix de R$ ${valorFormatado} foi pago com sucesso!`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      if (ADMIN_CHAT_ID) {
        bot.sendMessage(
          ADMIN_CHAT_ID,
          `💰 *SimPay Ltda — NOVO PAGAMENTO RECEBIDO!*\n\n` +
          `💵 *Valor Pago:* R$ ${valorFormatado}\n` +
          `🆔 *ID da Transação:* \`${txId}\`\n` +
          `📋 *Pedido:* \`${external_id}\`\n\n` +
          `🚀 *O valor de R$ ${valorFormatado} já está disponível no seu painel!*`,
          { parse_mode: 'Markdown' }
        ).catch(err => console.error('Erro ao notificar admin:', err.message));
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Erro no webhook:', error.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/', (req, res) => {
  res.send('Bot SimPay Ltda ativo!');
});

app.listen(PORT, () => {
  console.log(`Servidor SimPay Ltda rodando na porta ${PORT}`);
});
