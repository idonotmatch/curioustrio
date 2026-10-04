function receiptScanErrorPresentation(error = {}) {
  if (error?.reason_code === 'ai_unavailable') {
    return {
      title: 'Receipt scanner unavailable',
      message: 'The receipt scanner is temporarily unavailable. Try again shortly or enter the expense manually.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (`${error?.message || ''}`.includes('image too large')) {
    return {
      title: 'Image too large',
      message: 'Receipt image is too large. Try a closer crop.',
      canRetry: false,
      canEnterManually: false,
    };
  }

  if (`${error?.message || ''}`.includes('Could not parse receipt')) {
    return {
      title: 'Could not read receipt',
      message: "Couldn't read that receipt. Try better lighting or enter manually.",
      canRetry: true,
      canEnterManually: true,
    };
  }

  return null;
}

module.exports = { receiptScanErrorPresentation };
