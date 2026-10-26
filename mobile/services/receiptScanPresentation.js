function receiptScanErrorPresentation(error = {}) {
  if (error?.reason_code === 'receipt_scan_daily_limit' || error?.reason_code === 'receipt_scan_monthly_limit') {
    const period = error.reason_code === 'receipt_scan_daily_limit' ? 'today' : 'this month';
    return {
      title: 'Scan allowance reached',
      message: `You have used the receipt scans available ${period}. Manual entry is still available.`,
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'receipt_scan_capacity_reached') {
    return {
      title: 'Scanner temporarily busy',
      message: 'Receipt processing is temporarily at capacity. Try again later or enter the expense manually.',
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'receipt_scan_velocity_limit') {
    return {
      title: 'A few scans are already queued',
      message: 'Let the current receipt scans move forward before adding another.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'receipt_scan_in_progress' || error?.reason_code === 'receipt_scan_concurrent_limit') {
    return {
      title: 'Scan already in progress',
      message: 'Adlo is already reading a receipt for this account. Let that scan finish before starting another.',
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'receipt_scan_retry_exhausted') {
    return {
      title: 'Could not finish this scan',
      message: 'This image has already been tried twice. Take a clearer photo or enter the expense manually.',
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'receipt_scan_entitlement_paused') {
    return {
      title: 'Receipt scanning paused',
      message: 'Receipt scanning is paused for this account. Manual entry is still available.',
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'receipt_storage_unavailable') {
    return {
      title: 'Could not queue receipt',
      message: 'Secure receipt processing is temporarily unavailable. Try again shortly or enter the expense manually.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'rate_limited' || Number(error?.status) === 429) {
    return {
      title: 'Scanner is busy',
      message: 'Too many scans were requested at once. Adlo waited and retried; please try again in a moment.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'payload_too_large' || error?.reason_code === 'image_too_large') {
    return {
      title: 'Crop the receipt',
      message: 'The image is still too large after compression. Crop closer to the receipt and try again.',
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'unsupported_image_type') {
    return {
      title: 'Image format not supported',
      message: 'Choose a JPEG or PNG image, or take a new photo of the receipt.',
      canRetry: false,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'invalid_image_data' || error?.reason_code === 'image_unavailable') {
    return {
      title: 'Could not open image',
      message: 'The selected image could not be prepared. Choose it again or take a new photo.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'ai_timeout') {
    return {
      title: 'Receipt scan took too long',
      message: 'The image reached the scanner, but processing timed out. Try once more or enter the expense manually.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (error?.reason_code === 'ai_unavailable') {
    return {
      title: 'Receipt scanner unavailable',
      message: 'The receipt scanner is temporarily unavailable. Try again shortly or enter the expense manually.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  if (`${error?.message || ''}`.toLowerCase().includes('image too large')) {
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

  if (error?.code === 'network_error' || error?.code === 'request_timeout' || Number(error?.status) >= 500) {
    return {
      title: error?.code === 'request_timeout' ? 'Receipt scan took too long' : 'Could not reach scanner',
      message: 'Your image is safe on this device. Check your connection and try the scan again.',
      canRetry: true,
      canEnterManually: true,
    };
  }

  return null;
}

function receiptScanUsagePresentation(usage = {}) {
  if (!usage || usage.cached) return null;
  const remainingToday = usage.remaining_today == null ? null : Number(usage.remaining_today);
  const remainingMonth = usage.remaining_month == null ? null : Number(usage.remaining_month);
  if (Number.isInteger(remainingToday) && [5, 2, 0].includes(remainingToday)) {
    return {
      title: 'Receipt scans remaining',
      message: remainingToday === 0
        ? 'You have used today\'s receipt scans. Manual entry remains available.'
        : `${remainingToday} receipt scan${remainingToday === 1 ? '' : 's'} remaining today.`,
    };
  }
  if (Number.isInteger(remainingMonth) && [20, 10, 5, 0].includes(remainingMonth)) {
    return {
      title: 'Receipt scans remaining',
      message: remainingMonth === 0
        ? 'You have used this month\'s receipt scans. Manual entry remains available.'
        : `${remainingMonth} receipt scans remaining this month.`,
    };
  }
  return null;
}

module.exports = { receiptScanErrorPresentation, receiptScanUsagePresentation };
