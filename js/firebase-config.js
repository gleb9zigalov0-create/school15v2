const firebaseConfig = {
  apiKey: "AIzaSyC_3sU2TTh3K0u-SX-tPFMCSC189_4T-yw",
  authDomain: "school15-808fa.firebaseapp.com",
  projectId: "school15-808fa",
  storageBucket: "school15-808fa.firebasestorage.app",
  messagingSenderId: "1009889870107",
  appId: "1:1009889870107:web:7b89bb7476209ce5fd93be",
  measurementId: "G-WY1E90GHRB"
};

const CHAT_ROOM_ID = "class5a_chat";

function isFirebaseConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "";
}