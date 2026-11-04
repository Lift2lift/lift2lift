/** Plain-language messages for the reasons a check needs another try. */
export function identityErrorMessage(code: string | null) {
  switch (code) {
    case 'selfie_face_mismatch':
      return "Your selfie didn't match the photo on your license. Try again facing the camera in good light, without a hat or sunglasses.";
    case 'selfie_document_missing_photo':
      return "We couldn't find the photo on your license. Scan the front of the license again.";
    case 'selfie_manipulated':
    case 'selfie_unverified_other':
      return "The selfie couldn't be checked. Try again in good light.";
    case 'document_expired':
      return 'That license is expired. Use a current one.';
    case 'document_type_not_supported':
      return "Use a driver's license for this check.";
    case 'document_manipulated':
    case 'document_unverified_other':
      return "We couldn't read that license. Try again with a clear, glare-free photo of the front.";
    case 'under_supported_age':
      return 'You need to be 18 or older to drive on Lift2Lift.';
    case 'consent_declined':
      return 'The check stopped because consent was declined.';
    case 'device_not_supported':
      return "This device can't take the selfie. Try again on your phone.";
    default:
      return "The ID check didn't finish. Try again.";
  }
}

/** Plain-language messages for why an insurance card needs another try. */
export function insuranceErrorMessage(code: string | null) {
  switch (code) {
    case 'insurance_expired':
      return 'That card has expired. Use your current card.';
    case 'insurance_unreadable':
      return "We couldn't read the name and expiry date. Try a clear photo of the front, or a screenshot from your insurance app.";
    default:
      return "The check didn't finish. Try again.";
  }
}

/** Shown before the selfie check starts. Colorado treats face scans as biometric data, which needs consent. */
export const BIOMETRIC_CONSENT =
  "To confirm the license is yours, we send your license photo and selfie to our provider, Amazon Web Services, which reads the license and compares the two faces. This creates a face scan, which Colorado law treats as biometric data. Lift2Lift keeps only the result, the name on your license and your selfie, which becomes your profile photo that other members can see. We don't store your license photo or the face scan.";
