package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Patterns;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AutoCompleteTextView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import java.security.KeyPair;
import java.util.regex.Pattern;

public class SignUpDialog extends AlertDialog implements View.OnClickListener, TextView.OnEditorActionListener,View.OnTouchListener {
    private Handler m_uiHandler;
    private View m_view;

    SignUpDialog(Context context, Handler uiHandler) {
        super(context);
        m_uiHandler = uiHandler;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(R.layout.sign_up_dialog, null);
        setContentView(m_view);

        setCancelable(false);

        new SignUpFormManager().manage();

        m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.VISIBLE);

        m_view.findViewById(R.id.sign_up_switch_sign_in_button).setOnClickListener(this);
        m_view.findViewById(R.id.sign_up_button).setOnClickListener(this);
        ((EditText)m_view.findViewById(R.id.sign_up_retype_password)).setOnEditorActionListener(this);
        m_view.setOnTouchListener(this);

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    private class SignUpFormManager {
        boolean m_isEmailValid = false;
        boolean m_isPasswordStrong = false;
        boolean m_isPasswordConsistent = false;

        void manage() {
            final EditText emailEditText = m_view.findViewById(R.id.sign_up_email);
            final EditText passwordEditText = m_view.findViewById(R.id.sign_up_password);
            final EditText retypePasswordEditText = m_view.findViewById(R.id.sign_up_retype_password);

            m_view.findViewById(R.id.sign_up_button).setEnabled(false);
            //retypePasswordEditText.setImeOptions(EditorInfo.IME_ACTION_NONE);

            emailEditText.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                }

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {

                }

                @Override
                public void afterTextChanged(Editable s) {
                    if (Patterns.EMAIL_ADDRESS.matcher(s).matches()) {
                        m_isEmailValid = true;
                        validate();
                    } else {
                        emailEditText.setError("Invalid email address");
                        m_isEmailValid = false;
                    }

                }
            });

            passwordEditText.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                }

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {

                }

                @Override
                public void afterTextChanged(Editable s) {
                    if (Pattern.matches("^(?=.*?\\d)(?=.*?[A-Z]).{8,}$", s)) {
                        m_isPasswordStrong = true;
                        validate();
                    } else {
                        passwordEditText.setError("Password too weak");
                        m_isPasswordStrong = false;
                    }

                    if (retypePasswordEditText.getText().toString().equals(passwordEditText.getText().toString())) {
                        m_isPasswordConsistent = true;
                        validate();
                    } else {
                        retypePasswordEditText.setError("Password inconsistent");
                        m_isPasswordConsistent = false;
                    }
                }
            });

            retypePasswordEditText.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                }

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {

                }

                @Override
                public void afterTextChanged(Editable s) {
                    if ((retypePasswordEditText.getText().toString().equals(passwordEditText.getText().toString()))) {
                        m_isPasswordConsistent = true;
                        validate();
                    } else {
                        retypePasswordEditText.setError("Password inconsistent");
                        m_isPasswordConsistent = false;
                    }
                }
            });
        }

        private void validate() {
            m_view.findViewById(R.id.sign_up_button).setEnabled(m_isEmailValid && m_isPasswordStrong && m_isPasswordConsistent);
            //((EditText) m_view.findViewById(R.id.sign_up_retype_password)).setImeOptions((m_isEmailValid && m_isPasswordStrong && m_isPasswordConsistent) ? EditorInfo.IME_ACTION_DONE : EditorInfo.IME_ACTION_NONE);
        }

    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.sign_up_switch_sign_in_button:
                onClickSwitchSignIn(view);
                break;
            case R.id.sign_up_button:
                onClickSignUp(view);
                break;
            default:
                //do nothing
        }
    }

    @Override
    public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
        if (actionId != EditorInfo.IME_ACTION_DONE) {
            return false;
        } else if (v.getId() == R.id.sign_up_retype_password) {
            onClickSignUp(v);
            return true;
        } else {
            return false;
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(v.getWindowToken(), 0);

        v.performClick();
        return false;
    }

    public void onClickSwitchSignIn(View view) {
        m_uiHandler.sendEmptyMessage(R.integer.action_sign_in);
        dismiss();
    }

    public void onClickSignUp(View view) {
        AutoCompleteTextView emailView = findViewById(R.id.sign_up_email);
        EditText passwordView = findViewById(R.id.sign_up_password);
        EditText retypePasswordView = findViewById(R.id.sign_up_retype_password);

        String email = emailView.getText().toString();
        String password = passwordView.getText().toString();

        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(view.getWindowToken(), 0);

        m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.VISIBLE);

        new SignUpTask().execute(email, password);
    }

    private class SignUpTask extends AsyncTask<String, Integer, Integer> {

        private static final int PROGRESS_START_SIGN_UP = 0;
        private static final int PROGRESS_CHECK_EMAIL = 1;
        private static final int PROGRESS_CALC_DIGEST = 2;
        private static final int PROGRESS_GEN_RSA_KEY = 3;
        private static final int PROGRESS_CREATE_ACCOUNT = 4;
        private static final int PROGRESS_FINISH_SIGN_UP = 5;

        private static final int RESULT_SUCCESS = 0;
        private static final int RESULT_ERROR_EMAIL_CONFLICTED = 1;
        private static final int RESULT_ERROR_CALCULATE_DIGEST_FAILED = 2;
        private static final int RESULT_ERRIR_GEN_RSA_KEY_FAILED = 3;
        private static final int RESULT_ERROR_CREATE_ACCOUNT_FAILED = 4;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
        }

        @Override
        protected Integer doInBackground(String... parameter) {

            String email = parameter[0];
            String password = parameter[1];

            SqliteOpenHelper sqliteOpenHelper;

            publishProgress(PROGRESS_START_SIGN_UP);
            // do something?

            publishProgress(PROGRESS_CHECK_EMAIL);
            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            boolean conflict = sqliteOpenHelper.checkEmailConfliction(email);
            sqliteOpenHelper.close();
            if (conflict) {
                return RESULT_ERROR_EMAIL_CONFLICTED;
            }

            publishProgress(PROGRESS_CALC_DIGEST);
            String shadow = Utilities.caculateDigist(email, password);
            if (shadow == null) {
                return RESULT_ERROR_CALCULATE_DIGEST_FAILED;
            }

            publishProgress(PROGRESS_GEN_RSA_KEY);
            KeyPair keyPair = Utilities.generateRSAKey();
            if (keyPair == null) {
                return RESULT_ERRIR_GEN_RSA_KEY_FAILED;
            }

            publishProgress(PROGRESS_CREATE_ACCOUNT);
            String public_key = Utilities.getEncodedPublicKey(keyPair);
            String private_key = Utilities.getEncodedPrivateKey(keyPair);
            String encrypted_public_key = Utilities.tripleDesEncrypt(public_key, password);
            String encrypted_private_key = Utilities.tripleDesEncrypt(private_key, password);

            //Log.i("RSAKEY", keyPair.getPublic().getAlgorithm() + ":" + keyPair.getPublic().getFormat() + ":" + strPublicKey);
            //Log.i("RSAKEY", keyPair.getPrivate().getAlgorithm() + ":" + keyPair.getPrivate().getFormat() + ":" + strPrivateKey);
            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            sqliteOpenHelper.insertUser(email, shadow, encrypted_public_key, encrypted_private_key);
            sqliteOpenHelper.close();

            publishProgress(PROGRESS_FINISH_SIGN_UP);

            return RESULT_SUCCESS;
        }

        @Override
        protected void onProgressUpdate(Integer... progress) {
            TextView progressMessageTextView = m_view.findViewById(R.id.sign_up_progress_message);

            switch (progress[0]) {
                case PROGRESS_START_SIGN_UP:
                    progressMessageTextView.setText(R.string.sign_up_progress_start);
                    break;
                case PROGRESS_CHECK_EMAIL:
                    progressMessageTextView.setText(R.string.sign_up_progress_check_email);
                    break;
                case PROGRESS_CALC_DIGEST:
                    progressMessageTextView.setText(R.string.sign_up_progress_calculate_digest);
                    break;
                case PROGRESS_GEN_RSA_KEY:
                    progressMessageTextView.setText(R.string.sign_up_progress_generate_rsa_key);
                    break;
                case PROGRESS_CREATE_ACCOUNT:
                    progressMessageTextView.setText(R.string.sign_up_progress_create_account);
                    break;
                case PROGRESS_FINISH_SIGN_UP:
                    progressMessageTextView.setText(R.string.sign_up_progress_finish);
                    break;
                default:
            }
        }

        @Override
        protected void onPostExecute(Integer result) {
            if (result == RESULT_SUCCESS) {
                dismiss();
                Utilities.jam(getContext(), R.string.sign_up_progress_finish);
            } else {
                switch (result) {
                    case RESULT_ERROR_EMAIL_CONFLICTED:
                        Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.error_email_conflicted);
                        break;
                    case RESULT_ERROR_CALCULATE_DIGEST_FAILED:
                        Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.error_calculate_digest_failed);
                        break;
                    case RESULT_ERRIR_GEN_RSA_KEY_FAILED:
                        Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.error_generate_rsa_key_failed);
                        break;
                    default:
                }

                m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.GONE);
                m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.VISIBLE);
            }
        }
    }
}
