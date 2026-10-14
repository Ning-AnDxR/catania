export function appendEvent(
  state,
  type,
  payload = {},
  visibility = "PUBLIC",
  recipientPlayerId = null,
) {
  const event = {
    eventId: `event-${state.version}-${state.eventSequence}`,
    gameId: state.gameId,
    version: state.version,
    sequence: state.eventSequence,
    type,
    visibility,
    recipientPlayerId,
    payload,
  };
  state.eventSequence += 1;
  state.eventLog.push(event);
  if (state.eventLog.length > 300) state.eventLog.shift();
  return event;
}
