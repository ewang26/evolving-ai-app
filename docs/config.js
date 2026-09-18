/* Evolving AI — deployment config.
   apiUrl: the Apps Script Web App URL that writes to the shared Google Sheet.
           Leave it empty and the app still works: submissions are kept on the
           device and in each participant's personal link, and the organizer
           console accepts pasted submissions instead.
           Setup: see sheet-backend.gs and README.md. */
window.EAI_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxPqMTtvA8nZnTPS4J3bl7yekPPWafkvvuJTliI0eJx9vvxTCSBr2feWLnGyD726eGN/exec",
  deadline: "Monday, October 5"
};
