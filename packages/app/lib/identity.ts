/** Plain-language messages for Stripe Identity's reasons a check needs another try. */
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
      return "Stripe couldn't verify that license. Try again with a clear, glare-free scan.";
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

/** Shown before the selfie check starts. Colorado treats face scans as biometric data, which needs consent. */
export const BIOMETRIC_CONSENT =
  "To confirm the license is yours, our ID partner Stripe compares a live selfie with your license photo. This creates a face scan, which Colorado law treats as biometric data. Stripe does the comparison: Lift2Lift never receives the face scan or your license images. When the check passes, your selfie becomes your profile photo, which other Lift2Lift members can see. Then we ask Stripe to delete your license images, selfie and face scan, and keep only the result and the name on your license.";
