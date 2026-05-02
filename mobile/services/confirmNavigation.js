import { stashNavigationPayload } from './navigationPayloadStore';

export function pushConfirmDraft(router, confirmData = {}) {
  const payloadKey = stashNavigationPayload({ confirmData }, 'confirm');
  router.push({
    pathname: '/confirm',
    params: { payload_key: payloadKey },
  });
}
