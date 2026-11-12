import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'

function unused(): never {
  throw new Error('This directory-only agent fixture must not drive model turns or inbox state.')
}

export function directoryAgent(ctx: Context, cwd: string): Agent {
  const id = SessionId('csv-directory-test')
  return {
    id,
    ctx,
    session: Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, isSeeded: false, createdAt: 0, cwd, delegationDepth: 0 }),
    options: {},
    status: 'idle',
    model: { current: unused, select: unused },
    inbox: { nextTurn: [], nextStep: [], clear: unused, append: unused, prepend: unused, replace: unused, remove: unused, splice: unused },
    cancel: unused,
    whenIdle: unused,
    runMaintenance: unused,
    send: unused,
    followup: unused,
    steer: unused,
    inject: unused,
  }
}
