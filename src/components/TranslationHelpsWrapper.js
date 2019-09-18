import React, { useState } from 'react';

function TranslationHelpsWrapper() {
  const [greeting, setGreeting] = useState('hello');

  return <div onClick={() => setGreeting('Hey')}>
    <span>{greeting} world!</span>
  </div>;
}

export default TranslationHelpsWrapper;
