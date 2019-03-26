# tc-tool-wrapper

translationCore tool wrapper

## Usage

- Install `tc-tool-wrapper` in tCore repo.

    ```bash
    npm i tc-tool-wrapper
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
    } from 'tc-tool-wrapper';

    export default connectTool('translationWords', {
      localeDir: path.join(__dirname, './src/locale'),
      api: new Api()
    })(connect(mapStateToProps)(Container));
    ```

## Testing your changes

- Create your feature/bugfix/enhancement (my-feature-branch)branch off of master.
- Make your changes in the new branch (my-feature-branch).
- Push your chnages.
- Run `npm i translationCoreApps/tc-tool-wrapper#my-feature-branch` in your translationCore root directory.
