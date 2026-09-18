/* Evolving AI — deployment config.
   apiUrl: the Apps Script Web App URL that writes to the shared Google Sheet.
           Leave it empty and the app still works: submissions are kept on the
           device and in each participant's personal link, and the organizer
           console accepts pasted submissions instead.
           Setup: see sheet-backend.gs and README.md. */
window.EAI_CONFIG = {
  apiUrl: "",
  deadline: "Monday, October 5"
};
