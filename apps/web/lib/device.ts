'use client';

import type { DeviceServices, PickedPhoto } from '@lift2lift/app';

const MAX_SIDE = 1800; // px; plenty to read a license, keeps uploads small

export const webDevice: DeviceServices = {
  platform: 'web',
  logo: { uri: '/logo.png' },

  /** Stripe's hosted ID check; it sends the person back to /account/driver?verify=done. */
  /** Web has no lock-screen pushes; ride reminders show in the app's Your Rides tab instead. */
  async registerForPush() {
    return null;
  },

  // localStorage can throw (private windows, blocked site data); treat that as "not saved".
  async getPref(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async setPref(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // not saved; it falls back to the default next visit
    }
  },

  getLocation() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve(null),
        { maximumAge: 10 * 60 * 1000, timeout: 10000 },
      );
    });
  },

  openIdentityCheck(url) {
    window.location.assign(url);
    return new Promise<void>(() => {}); // the page is leaving
  },

  /** Opens the file chooser (on phones this offers the camera too), then shrinks the photo to a JPEG. */
  pickPhoto() {
    return new Promise<PickedPhoto | null>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      let settled = false;
      const done = (v: PickedPhoto | null) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      input.addEventListener('cancel', () => done(null));
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return done(null);
        try {
          done(await shrink(file));
        } catch (e) {
          settled = true;
          reject(e);
        }
      });
      input.click();
    });
  },
};

async function shrink(file: File): Promise<PickedPhoto> {
  const fallback = (): PickedPhoto => ({
    body: file,
    contentType: file.type || 'image/jpeg',
    ext: /png/i.test(file.type) ? 'png' : /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name) ? 'heic' : /webp/i.test(file.type) ? 'webp' : 'jpg',
    previewUri: URL.createObjectURL(file),
  });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fallback(); // e.g. HEIC in browsers that can't decode it: upload as-is
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) return fallback();
  return { body: blob, contentType: 'image/jpeg', ext: 'jpg', previewUri: URL.createObjectURL(blob) };
}
