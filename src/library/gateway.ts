import assert from 'assert';
import {EventEmitter} from 'events';
import {Server} from 'http';
import {ListenOptions} from 'net';

import Koa, {Context, Next} from 'koa';
import Session from 'koa-session';

import {LogFunction} from './log';
import {
  GATEWAY_TARGET_CONSTRUCTOR_DICT,
  GatewayTargetDescriptor,
  IGatewayTarget,
  IGatewayTargetDescriptor,
} from './target';

const GATEWAY_OPTIONS_DEFAULT = {
  session: true,
};

export interface GatewayOptions {
  keys?: string[];
  listen: ListenOptions;
  session?: GatewaySessionOptions | boolean;
  targets: GatewayTargetDescriptor[];
}

export class Gateway extends EventEmitter {
  private koa: Koa = new Koa();

  private sessionEnabled: boolean;

  private targets: IGatewayTarget<IGatewayTargetDescriptor>[] = [];

  constructor(private options: GatewayOptions) {
    super();

    let {
      keys,
      session: sessionOptions = GATEWAY_OPTIONS_DEFAULT.session,
      targets: targetDescriptors,
    } = options;

    let koa = this.koa;

    if (keys) {
      koa.keys = keys;
    }

    if (sessionOptions) {
      this.sessionEnabled = true;
      koa.use(
        Session(
          {
            ...(sessionOptions === true ? undefined : sessionOptions),
            // By calling `save()` it marked session force save on commit. However,
            // it won't reset the force save state after `manuallyCommit()`. This will result in
            // another auto commit that might cause error for proxy target (header
            // already sent). So we disable `autoCommit` altogether.
            autoCommit: false,
          },
          koa,
        ),
      );
    } else {
      this.sessionEnabled = false;
    }

    let targets = this.targets;

    for (let descriptor of targetDescriptors) {
      let Target = GATEWAY_TARGET_CONSTRUCTOR_DICT[descriptor.type];

      targets.push(new Target(descriptor, this.log));
    }

    koa.use(this.middleware);
  }

  serve(): Server {
    let {listen: listenOptions} = this.options;

    return this.koa.listen(listenOptions);
  }

  protected log: LogFunction = (event, data) => {
    this.emit('log', {
      event,
      ...data,
    });
  };

  private middleware = async (context: Context, next: Next): Promise<void> => {
    let target: IGatewayTarget<IGatewayTargetDescriptor> | undefined;
    let base: string | undefined;

    for (let candidateTarget of this.targets) {
      let candidateBase = candidateTarget.match(context);

      if (typeof candidateBase === 'string') {
        assert(context.url.startsWith(candidateBase));

        target = candidateTarget;
        base = candidateBase;
        break;
      }
    }

    if (!target) {
      context.body = 'No gateway target matched';
      return;
    }

    if (this.sessionEnabled && target.sessionEnabled) {
      let session = context.session!;

      if (!session._sessCtx.prevHash) {
        // If session has never been set.
        session.save();
      }

      await context.session!.manuallyCommit();
    }

    await target.handle(context, next, base!);
  };
}

export interface Gateway {
  emit(event: 'log', data: LogEventData): boolean;

  on(event: 'log', listener: (data: LogEventData) => void): this;
}

export interface GatewaySessionOptions
  extends Partial<Omit<Session.opts, 'autoCommit'>> {}

export interface LogEventData {
  /** The event that triggers this log. */
  event: string;
  [key: string]: unknown;
}
