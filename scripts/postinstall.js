const { execSync } = require('child_process');

// install native deps (prebuilt binaries from S3, versions in scripts/repositories.json)
execSync('node ./scripts/install-native-deps.js', { stdio: [0, 1, 2] });
