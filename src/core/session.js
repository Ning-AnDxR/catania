import { createCommandEnvelope, createGame, dispatchCommand } from "./engine.js";
import { projectPlayerView } from "./projection.js";

export class LocalGameSession {
  constructor(options = {}) {
    this.state = options.state
      ? structuredClone(options.state)
      : createGame(options);
    this.listeners = new Set();
    this.lastResult = null;
  }

  get version() {
    return this.state.version;
  }

  get phase() {
    return this.state.phase;
  }

  dispatch(actorId, command, commandId) {
    const envelope = createCommandEnvelope(this.state, actorId, command, commandId);
    const outcome = dispatchCommand(this.state, envelope);
    this.lastResult = outcome.result;
    if (outcome.result.accepted) this.state = outcome.state;
    this.emit(outcome.result);
    return outcome.result;
  }

  start(actorId = 0) {
    return this.dispatch(actorId, { type: "START_GAME" });
  }

  getView(viewerId) {
    return projectPlayerView(this.state, viewerId);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(result) {
    for (const listener of this.listeners) listener(result);
  }
}
