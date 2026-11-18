import type { DeviceServices } from '@lift2lift/app';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

function chooseSource(): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null),
      );
    } else {
      Alert.alert('Add photo', undefined, [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose from library', onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

// Show ride reminders as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export const nativeDevice: DeviceServices = {
  platform: 'ios',
  logo: require('../assets/icon.png'),

  getPref: (key) => AsyncStorage.getItem(key),
  setPref: (key, value) => AsyncStorage.setItem(key, value),

  /** Location while the app is open, for live drive times. Coarse accuracy is plenty. */
  async getLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
      const p = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      return { lat: p.coords.latitude, lon: p.coords.longitude };
    } catch {
      return null;
    }
  },

  /**
   * Asks to send notifications and returns this phone's Expo push token. The
   * server (supabase/functions/send-ride-reminders) sends the 2-hour and
   * 5-minute ride reminders to it. Returns null on a simulator or if the person says no.
   */
  async registerForPush() {
    if (!Device.isDevice) return null;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
    }
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return { token: data, platform: Platform.OS === 'android' ? 'android' : 'ios' };
  },

  /** Stripe's hosted ID check in an in-app browser. Resolves when the person closes it. */
  async openIdentityCheck(url) {
    await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  },

  /** lift2lift://google-calendar in the app; an exp://…/--/google-calendar address in Expo Go. */
  googleReturnTo() {
    return Linking.createURL('google-calendar');
  },

  /** Google's sign-in in an auth session, which closes itself when Google sends the browser back to the app. */
  async openGoogleSignIn(url, returnTo) {
    const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
    if (result.type !== 'success') return null;
    try {
      return new URL(result.url).searchParams.get('google_calendar');
    } catch {
      return 'error';
    }
  },

  takeGoogleResult() {
    return null;
  },

  /** Camera or photo library, compressed to JPEG, read as bytes for Supabase Storage. */
  async pickPhoto() {
    const source = await chooseSource();
    if (!source) return null;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) throw new Error('Allow camera access for Lift2Lift in Settings to take a photo.');
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, exif: false };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return null;
    const contentType = asset.mimeType ?? 'image/jpeg';
    return {
      body: decode(asset.base64),
      contentType,
      ext: contentType.includes('png') ? 'png' : contentType.includes('hei') ? 'heic' : 'jpg',
      previewUri: asset.uri,
    };
  },
};
