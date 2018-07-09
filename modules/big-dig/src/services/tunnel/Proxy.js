/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow strict-local
 * @format
 */

import type {Observable} from 'rxjs';
import type {TunnelMessage} from './types';

import net from 'net';
import Encoder from './Encoder';

import {getLogger} from 'log4js';
import invariant from 'assert';
import EventEmitter from 'events';

const logger = getLogger('tunnel-proxy');

export type Transport = {
  send(string): void,
  onMessage(): Observable<string>,
};

export class Proxy extends EventEmitter {
  _localPort: number;
  _remotePort: number;
  _transport: Transport;
  _server: ?net.Server;
  _socketByClientId: Map<number, net.Socket>;
  _tunnelId: string;
  _useIPv4: boolean;

  constructor(
    tunnelId: string,
    localPort: number,
    remotePort: number,
    useIPv4: boolean,
    transport: Transport,
  ) {
    super();
    this._tunnelId = tunnelId;
    this._localPort = localPort;
    this._remotePort = remotePort;
    this._transport = transport;
    this._useIPv4 = useIPv4;
    this._server = null;
    this._socketByClientId = new Map();
  }

  static async createProxy(
    tunnelId: string,
    localPort: number,
    remotePort: number,
    useIPv4: boolean,
    transport: Transport,
  ): Promise<Proxy> {
    const proxy = new Proxy(
      tunnelId,
      localPort,
      remotePort,
      useIPv4,
      transport,
    );
    await proxy.startListening();

    return proxy;
  }

  async startListening(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server = net.createServer(socket => {
        const clientId: number = socket.remotePort;
        this._socketByClientId.set(clientId, socket);
        this._sendMessage({
          event: 'connection',
          clientId,
        });

        // forward events over the transport
        ['timeout', 'error', 'end', 'close', 'data'].forEach(event => {
          socket.on(event, arg => {
            this._sendMessage({
              event,
              arg,
              clientId,
            });
          });
        });

        socket.once('error', error => {
          this.emit('error', error);
          this._destroySocket(clientId, error);
        });
        socket.once('close', this._closeSocket.bind(this, clientId));
      });

      this._server.on('error', err => {
        this._sendMessage({
          event: 'proxyError',
          port: this._localPort,
          useIpv4: this._useIPv4,
          remotePort: this._remotePort,
          error: JSON.stringify(err),
        });
        reject(err);
      });

      invariant(this._server);
      this._server.listen({port: this._localPort}, () => {
        logger.info(
          `successfully started listening on port ${this._localPort}`,
        );
        // send a message to create the SocketManager
        this._sendMessage({
          event: 'proxyCreated',
          port: this._localPort,
          useIPv4: this._useIPv4,
          remotePort: this._remotePort,
        });
        resolve();
      });
    });
  }

  getId(): string {
    return this._tunnelId;
  }

  receive(msg: TunnelMessage): void {
    const clientId = msg.clientId;
    invariant(clientId != null);
    const socket = this._socketByClientId.get(clientId);
    invariant(socket);
    const arg = msg.arg;
    invariant(arg != null);

    if (msg.event === 'data') {
      socket.write(arg);
    }
  }

  _closeSocket(id: number) {
    logger.info(`socket ${id} closed`);
    const socket = this._socketByClientId.get(id);
    invariant(socket);
    socket.removeAllListeners();
    this._socketByClientId.delete(id);
  }

  _destroySocket(id: number, error: Error) {
    logger.error('error on socket: ', error);
    const socket = this._socketByClientId.get(id);
    invariant(socket);
    socket.destroy(error);
    this._closeSocket(id);
  }

  _sendMessage(msg: TunnelMessage): void {
    this._transport.send(Encoder.encode({tunnelId: this._tunnelId, ...msg}));
  }

  close(): void {
    if (this._server != null) {
      this._server.close();
      this._server = null;
    }
    this._socketByClientId.forEach((socket, id) => {
      socket.end();
    });
    this.removeAllListeners();
    this._sendMessage({event: 'proxyClosed'});
  }
}
