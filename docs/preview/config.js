/* Evolving AI — deployment config.
   apiUrl: the deployed Apps Script web app that writes to the shared Google Sheet.
           Emptying it does not break the app: submissions then live on the device
           and in each participant's personal link, and the organizer console falls
           back to accepting pasted submissions. See README.md. */
window.EAI_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxPqMTtvA8nZnTPS4J3bl7yekPPWafkvvuJTliI0eJx9vvxTCSBr2feWLnGyD726eGN/exec",
  deadline: "Monday, October 5"
};
