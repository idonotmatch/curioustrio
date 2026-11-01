import { stashNavigationPayload } from './navigationPayloadStore';

export function pushConfirmDraft(router, confirmData = {}, { navigationAction = 'push' } = {}) {
  const payloadKey = stashNavigationPayload({ confirmData }, 'confirm');
  const action = navigationAction === 'replace' ? 'replace' : 'push';
  router[action]({
    pathname: '/confirm',
    params: { payload_key: payloadKey },
  });
}
