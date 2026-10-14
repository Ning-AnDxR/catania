import test from "node:test";
import assert from "node:assert/strict";

import { chooseRandomCommand } from "../src/bots/random-bot.js";
import { GAME_PHASES } from "../src/core/constants.js";
import { LocalGameSession } from "../src/core/session.js";

test("random bots can complete the setup phase without illegal commands", () => {
  const session = new LocalGameSession({
    gameId: "bot-setup-test",
    seed: "bot-seed",
    players: [
      { name: "Bot 1", isBot: true },
      { name: "Bot 2", isBot: true },
      { name: "Bot 3", isBot: true },
      { name: "Bot 4", isBot: true },
    ],
  });

  assert.equal(session.start(0).accepted, true);

  let steps = 0;
  while (session.phase !== GAME_PHASES.AWAITING_ROLL && steps < 100) {
    const actorId = session.state.currentPlayerId;
    const view = session.getView(actorId);
    const command = chooseRandomCommand(view, () => 0);
    assert.ok(command, `No command available at step ${steps}`);
    const result = session.dispatch(actorId, command);
    assert.equal(result.accepted, true, result.error?.message);
    steps += 1;
  }

  assert.equal(session.phase, GAME_PHASES.AWAITING_ROLL);
  assert.equal(steps, 16);
});

