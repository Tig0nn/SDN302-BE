const env = require('../../config/env');

const PERMANENT_TOKEN_ERRORS = new Set(['DeviceNotRegistered']);

function toExpoMessage(token, event) {
  return {
    to: token.expoPushToken,
    sound: 'default',
    title: event.title,
    body: event.body,
    data: {
      notificationId: event.id,
      type: event.type,
      ...(event.payload || {}),
    },
  };
}

function inactiveTokensFromTickets(tokens, tickets) {
  const inactiveTokens = [];

  tickets.forEach((ticket, index) => {
    const errorCode = ticket?.details?.error;

    if (ticket?.status === 'error' && PERMANENT_TOKEN_ERRORS.has(errorCode)) {
      inactiveTokens.push(tokens[index].expoPushToken);
    }
  });

  return inactiveTokens;
}

async function sendExpoNotification(tokens, event) {
  if (tokens.length === 0) {
    return {
      attempted: false,
      inactiveTokens: [],
    };
  }

  const response = await fetch(env.EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
    },
    body: JSON.stringify(tokens.map((token) => toExpoMessage(token, event))),
  });

  if (!response.ok) {
    return {
      attempted: false,
      inactiveTokens: [],
    };
  }

  const body = await response.json();
  const tickets = Array.isArray(body.data) ? body.data : [];

  return {
    attempted: true,
    inactiveTokens: inactiveTokensFromTickets(tokens, tickets),
  };
}

module.exports = {
  sendExpoNotification,
};
