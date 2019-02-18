package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Patterns;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.AutoCompleteTextView;
import android.widget.EditText;
import android.widget.TextView;

import java.security.KeyPair;
import java.util.regex.Pattern;

public class SignUpDialog extends AlertDialog implements View.OnClickListener, View.OnTouchListener {
    private Handler m_uiHandler;
    private View m_view;
    private SignUpFormManager m_manager;

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

        m_manager = new SignUpFormManager(m_view);
        m_manager.manage();

        m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.VISIBLE);

        m_view.findViewById(R.id.sign_up_switch_sign_in).setOnClickListener(this);
        m_view.findViewById(R.id.sign_up_sign_up).setOnClickListener(this);
        m_view.setOnTouchListener(this);

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    @Override
    public void dismiss() {
        m_view.setOnTouchListener(null);
        m_view.findViewById(R.id.sign_up_sign_up).setOnClickListener(null);
        m_view.findViewById(R.id.sign_up_switch_sign_in).setOnClickListener(null);

        m_manager.unmanage();

        super.dismiss();
    }

    private class SignUpFormManager {
        private View m_rootView;
        private EditText emailEditText;
        private EditText passwordEditText;
        private EditText retype_passwordEditText;
        private boolean m_isEmailValid;
        private boolean m_isPasswordStrong;
        private boolean m_isPasswordConsistent;

        SignUpFormManager(View view) {
            m_rootView = view;
            emailEditText = m_rootView.findViewById(R.id.sign_up_email);
            passwordEditText = m_rootView.findViewById(R.id.sign_up_password);
            retype_passwordEditText = m_rootView.findViewById(R.id.sign_up_retype_password);
            m_isEmailValid = false;
            m_isPasswordStrong = false;
            m_isPasswordConsistent = false;
        }

        private TextWatcher m_emailTextWatcher = new TextWatcher() {
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
                } else {
                    emailEditText.setError("Invalid email address");
                    m_isEmailValid = false;
                }
                validate();
            }
        };

        private TextWatcher m_passwordTextWatcher = new TextWatcher() {
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
                } else {
                    passwordEditText.setError("Password too weak");
                    m_isPasswordStrong = false;
                }

                if (retype_passwordEditText.getText().toString().equals(passwordEditText.getText().toString())) {
                    retype_passwordEditText.setError(null);
                    m_isPasswordConsistent = true;
                } else {
                    retype_passwordEditText.setError("Password inconsistent");
                    m_isPasswordConsistent = false;
                }
                validate();
            }
        };

        private TextWatcher m_retype_passwordTextWathcer = new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {

            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {

            }

            @Override
            public void afterTextChanged(Editable s) {
                if (retype_passwordEditText.getText().toString().equals(passwordEditText.getText().toString())) {
                    m_isPasswordConsistent = true;
                } else {
                    retype_passwordEditText.setError("Password inconsistent");
                    m_isPasswordConsistent = false;
                }
                validate();
            }
        };

        void manage() {
            m_rootView.findViewById(R.id.sign_up_sign_up).setEnabled(false);

            emailEditText.addTextChangedListener(m_emailTextWatcher);
            passwordEditText.addTextChangedListener(m_passwordTextWatcher);
            retype_passwordEditText.addTextChangedListener(m_retype_passwordTextWathcer);
        }

        void unmanage() {
            emailEditText.removeTextChangedListener(m_emailTextWatcher);
            passwordEditText.removeTextChangedListener(m_passwordTextWatcher);
            retype_passwordEditText.removeTextChangedListener(m_retype_passwordTextWathcer);
        }

        private void validate() {
            m_rootView.findViewById(R.id.sign_up_sign_up).setEnabled(m_isEmailValid && m_isPasswordStrong && m_isPasswordConsistent);
        }
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.sign_up_switch_sign_in:
                onClickSwitchSignIn(view);
                break;
            case R.id.sign_up_sign_up:
                onClickSignUp(view);
                break;
            default:
                //do nothing
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(v.getWindowToken(), 0);

        v.performClick();
        return false;
    }

    private void onClickSwitchSignIn(View view) {
        m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_DO_SIGN_IN);
        dismiss();
    }

    private void onClickSignUp(View view) {
        AutoCompleteTextView emailView = findViewById(R.id.sign_up_email);
        EditText passwordView = findViewById(R.id.sign_up_password);

        String email = emailView.getText().toString();
        String password = passwordView.getText().toString();

        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(view.getWindowToken(), 0);

        m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.VISIBLE);

        new SignUpTask().execute(email, password);
    }

    private class SignUpTask extends AsyncTask<String, Integer, Integer> {

        private static final int SIGN_UP_PROGRESS_START = 0;
        private static final int SIGN_UP_PROGRESS_CHECK_EMAIL = 1;
        private static final int SIGN_UP_PROGRESS_CALC_DIGEST = 2;
        private static final int SIGN_UP_PROGRESS_GEN_RSA_KEY = 3;
        private static final int SIGN_UP_PROGRESS_CREATE_ACCOUNT = 4;
        private static final int SIGN_UP_PROGRESS_FINISHED = 5;

        private static final int SIGN_UP_RESULT_SUCCESS = 0;
        private static final int SIGN_UP_RESULT_ERROR_EMAIL_CONFLICTED = 1;
        private static final int SIGN_UP_RESULT_ERROR_CALCULATE_DIGEST_FAILED = 2;
        private static final int SIGN_UP_RESULT_ERRIR_GEN_RSA_KEY_FAILED = 3;
        private static final int SIGN_UP_RESULT_ERROR_CREATE_ACCOUNT_FAILED = 4;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
        }

        @Override
        protected Integer doInBackground(String... parameter) {

            String email = parameter[0];
            String password = parameter[1];

            SqliteOpenHelper sqliteOpenHelper;

            publishProgress(SIGN_UP_PROGRESS_START);
            // do something?

            publishProgress(SIGN_UP_PROGRESS_CHECK_EMAIL);

            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            boolean conflict = sqliteOpenHelper.checkEmailConfliction(email);
            sqliteOpenHelper.close();
            if (conflict) {
                return SIGN_UP_RESULT_ERROR_EMAIL_CONFLICTED;
            }

            publishProgress(SIGN_UP_PROGRESS_CALC_DIGEST);

            String shadow = Utilities.caculateDigist(email, password);
            if (shadow == null) {
                return SIGN_UP_RESULT_ERROR_CALCULATE_DIGEST_FAILED;
            }

            publishProgress(SIGN_UP_PROGRESS_GEN_RSA_KEY);

            KeyPair keyPair = Utilities.generateRSAKey();
            if (keyPair == null) {
                return SIGN_UP_RESULT_ERRIR_GEN_RSA_KEY_FAILED;
            }

            publishProgress(SIGN_UP_PROGRESS_CREATE_ACCOUNT);

            String public_key = Utilities.encodedPublicKey(keyPair.getPublic());
            String private_key = Utilities.encodedPrivateKey(keyPair.getPrivate());
            String encrypted_public_key = Utilities.tripleDesEncrypt(public_key, password);
            String encrypted_private_key = Utilities.tripleDesEncrypt(private_key, password);

            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            sqliteOpenHelper.insertUser(email, shadow, encrypted_public_key, encrypted_private_key);
            sqliteOpenHelper.close();

            publishProgress(SIGN_UP_PROGRESS_FINISHED);

            m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_DO_SIGN_IN);

            return SIGN_UP_RESULT_SUCCESS;
        }

        @Override
        protected void onProgressUpdate(Integer... progress) {
            TextView progressMessageTextView = m_view.findViewById(R.id.sign_up_progress_message);

            switch (progress[0]) {
                case SIGN_UP_PROGRESS_START:
                    progressMessageTextView.setText(R.string.sign_up_progress_start);
                    break;
                case SIGN_UP_PROGRESS_CHECK_EMAIL:
                    progressMessageTextView.setText(R.string.sign_up_progress_check_email);
                    break;
                case SIGN_UP_PROGRESS_CALC_DIGEST:
                    progressMessageTextView.setText(R.string.sign_up_progress_calculate_digest);
                    break;
                case SIGN_UP_PROGRESS_GEN_RSA_KEY:
                    progressMessageTextView.setText(R.string.sign_up_progress_generate_rsa_key);
                    break;
                case SIGN_UP_PROGRESS_CREATE_ACCOUNT:
                    progressMessageTextView.setText(R.string.sign_up_progress_create_account);
                    break;
                case SIGN_UP_PROGRESS_FINISHED:
                    progressMessageTextView.setText(R.string.sign_up_progress_finish);
                    break;
                default:
            }
        }

        @Override
        protected void onPostExecute(Integer result) {
            switch (result) {
                case SIGN_UP_RESULT_ERROR_EMAIL_CONFLICTED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_up_result_error_email_conflicted);
                    break;
                case SIGN_UP_RESULT_ERROR_CALCULATE_DIGEST_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_up_result_error_calculate_digest_failed);
                    break;
                case SIGN_UP_RESULT_ERRIR_GEN_RSA_KEY_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_up_result_error_generate_rsa_key_failed);
                    break;
                case SIGN_UP_RESULT_SUCCESS:
                    Utilities.jam(getContext(), R.string.sign_up_result_success);
                    dismiss();
                    break;
                default:
            }

            m_view.findViewById(R.id.sign_up_progress_panel).setVisibility(View.GONE);
            m_view.findViewById(R.id.sign_up_form_panel).setVisibility(View.VISIBLE);
        }
    }
}
