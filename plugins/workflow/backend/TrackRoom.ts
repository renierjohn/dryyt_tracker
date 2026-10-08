import { DurableObject } from 'cloudflare:workers';

export interface TrackUpdate {
  status: string;
  updated_at: string;
}

// One per transaction code (getByName(code)): holds the WebSockets of every
// open /track?code= page and pushes status changes to them. Hibernatable
// sockets, so an idle room costs nothing; nothing is stored — the page loads
// the current state over HTTP first and only needs changes from here.
export class TrackRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected_websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(update: TrackUpdate): void {
    const message = JSON.stringify(update);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Already closing — webSocketClose cleans it up.
      }
    }
  }

  // Listen-only: anything the page sends is ignored.
  webSocketMessage(): void {}

  // Complete the close handshake. No code echoed back: the client's may be a
  // reserved one (1005 "no status") that close() refuses.
  webSocketClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
}
