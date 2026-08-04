// Styles
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

// Composables
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

// Labs components
import { VDateInput } from 'vuetify/labs/VDateInput';
import { VFileUpload } from 'vuetify/labs/VFileUpload';

// Load Poppins from Google Fonts + keep your local SF Pro
const fontStyle = document.createElement('style');
fontStyle.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');

  @font-face {
    font-family: 'SF Pro';
    src: url('/fonts/SF-Pro-Display-Regular.otf') format('opentype');
    font-style: normal;
  }
`;
document.head.appendChild(fontStyle);

export default createVuetify({
    components: {
        ...components,
        VDateInput,
        VFileUpload,
    },
    directives,

    theme: {
        defaultTheme: 'light',
        themes: {
            light: {
                colors: {
                    primary: '#075BAB',
                    primary2: '#699BCB',
                    secondary: '#656264',
                    surface: '#FFFFFF',
                    background: '#F9FAFB',
                    error: '#EF4444',
                    success: '#22C55E',
                    warning: '#F97316',
                    info: '#3B82F6',
                },
                variables: {
                    // This is the Vuetify-native way to set the global font.
                    // It sets --v-font-family which all Vuetify components inherit.
                    fontFamily: 'Poppins, sans-serif',
                },
            },
            dark: {
                colors: {
                    surface: '#000000',
                    primary: '#000000',
                    background: '#121212',
                },
                variables: {
                    fontFamily: 'Poppins, sans-serif',
                },
            },
        },
    },
});
