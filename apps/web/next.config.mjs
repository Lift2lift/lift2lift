/**
 * Next.js renders the shared React Native screens through react-native-web:
 * every `import ... from 'react-native'` resolves to `react-native-web`.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@lift2lift/app', 'react-native-web', 'react-native-safe-area-context'],
  webpack: (config, { webpack }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'react-native$': 'react-native-web',
    };
    config.resolve.extensions = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', ...config.resolve.extensions];
    config.plugins.push(new webpack.DefinePlugin({ __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production') }));
    return config;
  },
  // Same mapping for `next dev --turbopack`.
  turbopack: {
    resolveAlias: { 'react-native': 'react-native-web' },
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
};

export default nextConfig;
