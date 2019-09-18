import React, { useState, useEffect } from 'react';

function TranslationHelpsWrapper() {
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    setGreeting('hello');
  }, []);

  return <div onClick={() => setGreeting('Hey')}>
    <span>{greeting} world!</span>
  </div>;
}

export default TranslationHelpsWrapper;
