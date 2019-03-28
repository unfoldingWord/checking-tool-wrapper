# checking-tool-wrapper

Checking tool wrapper for translationCore App

## Usage

- Install `checking-tool-wrapper` in tCore repo.

    ```bash
    npm i checking-tool-wrapper
    ```

- Write the following code in the tool's `index.js` file:

    ```js
    import {connectTool} from 'tc-tool';
    import {connect} from 'react-redux';
    import path from 'path';
    import {
      Api,
      Container,
      mapStateToProps
    } from 'checking-tool-wrapper';

    export default connectTool('translationWords', {
      localeDir: path.join(__dirname, './src/locale'),
      api: new Api()
    })(connect(mapStateToProps)(Container));
    ```

## Testing your changes

- Create your feature/bugfix/enhancement (my-feature-branch)branch off of master.
- Make your changes in the new branch (my-feature-branch).
- Push your changes.
- Run `npm i translationCoreApps/checking-tool-wrapper#my-feature-branch` in your translationCore root directory.
