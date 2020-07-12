import assert from 'assert';
import {OutgoingMessage} from 'http';

import Server, {ServerOptions, createProxyServer} from 'http-proxy';
import {Context, Next} from 'koa';

import {AbstractGatewayTarget, IGatewayTargetDescriptor} from './target';

const setHeader = OutgoingMessage.prototype.setHeader;

export interface ProxyTargetDescriptor extends IGatewayTargetDescriptor {
  type: 'proxy';
  target: string;
  options?: Omit<ServerOptions, 'target' | 'ignorePath'>;
}

export class ProxyTarget extends AbstractGatewayTarget<ProxyTargetDescriptor> {
  private proxy: Server;

  constructor(descriptor: ProxyTargetDescriptor) {
    super(descriptor);

    let {options} = descriptor;

    this.proxy = createProxyServer({...options, ignorePath: true});
  }

  async handle(context: Context, _next: Next, base: string): Promise<void> {
    let {target} = this.descriptor;

    let url = context.url;

    assert(url.startsWith(base));

    target = `${target}${url.slice(base.length)}`;

    let setCookieHeaders = context.response.headers['set-cookie'] as
      | string[]
      | string
      | undefined;

    setCookieHeaders =
      setCookieHeaders === undefined
        ? []
        : typeof setCookieHeaders === 'string'
        ? [setCookieHeaders]
        : setCookieHeaders;

    let originalCookieHeader = context.request.headers['cookie'];
    let newCookieHeader = setCookieHeaders
      .map(header => header.match(/[^;]+/)![0])
      .join('; ');

    let headers = newCookieHeader
      ? {
          cookie: originalCookieHeader
            ? `${originalCookieHeader}; ${newCookieHeader}`
            : newCookieHeader,
        }
      : undefined;

    let req = context.req;
    let res = context.res;

    res.setHeader = setHeaderOverride;

    return new Promise((resolve, reject) => {
      res.on('finish', resolve);

      this.proxy.web(
        req,
        res,
        {
          target,
          headers,
        },
        reject,
      );
    });
  }
}

function setHeaderOverride(
  this: OutgoingMessage,
  name: string,
  value: string | number | string[],
): void {
  if (name.toLowerCase() === 'set-cookie') {
    let originalValue = this.getHeader('set-cookie');

    if (Array.isArray(originalValue) && typeof value !== 'number') {
      value = [...originalValue, ...(Array.isArray(value) ? value : [value])];
    }
  }

  return setHeader.call(this, name, value);
}