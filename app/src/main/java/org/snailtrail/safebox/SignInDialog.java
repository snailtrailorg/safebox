package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.ArrayAdapter;
import android.widget.AutoCompleteTextView;
import android.widget.EditText;
import android.widget.TextView;

import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.util.ArrayList;

public class SignInDialog extends AlertDialog implements View.OnClickListener {
    private Handler m_uiHandler;
    private View m_view;

    SignInDialog(Context context, Handler uiHandler) {
        super(context);
        m_uiHandler = uiHandler;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater)getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(R.layout.sign_in_dialog, null);
        setContentView(m_view);

        setCancelable(false);

        m_view.findViewById(R.id.sign_in_progress_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.sign_in_form_panel).setVisibility(View.VISIBLE);

        m_view.findViewById(R.id.sign_in_switch_sign_up).setOnClickListener(this);
        m_view.findViewById(R.id.sign_in_sign_in).setOnClickListener(this);

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);

        ArrayList<String> mruEmailList = new SqliteOpenHelper(getContext()).getUserEmailList();
        if (mruEmailList != null && ! mruEmailList.isEmpty()) {
            ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(), android.R.layout.simple_dropdown_item_1line, mruEmailList);
            AutoCompleteTextView autoCompleteTextView = findViewById(R.id.sign_in_email);
            autoCompleteTextView.setAdapter(adapter);
        }
    }

    @Override
    public void dismiss() {
        m_view.findViewById(R.id.sign_in_switch_sign_up).setOnClickListener(null);
        m_view.findViewById(R.id.sign_in_sign_in).setOnClickListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.sign_in_switch_sign_up:
                OnClickSwitchSignUp(view);
                break;
            case R.id.sign_in_sign_in:
                onClickSignIn(view);
                break;
            default:
                //do nothing
        }
    }

    private void OnClickSwitchSignUp(View view) {
        m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_DO_SIGN_UP);
        dismiss();
    }

    private void onClickSignIn(View view) {
        AutoCompleteTextView emailView = findViewById(R.id.sign_in_email);
        EditText passwordView = findViewById(R.id.sign_in_password);

        String email = emailView.getText().toString();
        String password = passwordView.getText().toString();

        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(view.getWindowToken(), 0);

        m_view.findViewById(R.id.sign_in_form_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.sign_in_progress_panel).setVisibility(View.VISIBLE);

        new SignInTask().execute(email, password);
    }

    private class SignInTask extends AsyncTask<String, Integer, Integer> {
        private static final int SIGN_IN_PROGRESS_START = 0;
        private static final int SIGN_IN_PROGRESS_LOAD_USER_INFO = 1;
        private static final int SIGN_IN_PROGRESS_CHECK_EMAIL = 2;
        private static final int SIGN_IN_PROGRESS_CHECK_PASSWORD = 3;
        private static final int SIGN_IN_PROGRESS_LOAD_RSA_KEY = 4;
        private static final int SIGN_IN_PROGRESS_FINISHED= 5;

        private static final int SIGN_IN_RESULT_SUCCESS = 0;
        private static final int SIGN_IN_RESULT_ERROR_EMAIL_DOES_NOT_EXIST = 1;
        private static final int SIGN_IN_RESULT_ERROR_PASSWORD_INCORRECT = 2;
        private static final int SIGN_IN_RESULT_ERRIR_LOAD_RSA_KEY_FAILED = 3;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
        }

        @Override
        protected Integer doInBackground(String... parameter) {

            String email = parameter[0];
            String password = parameter[1];

            SqliteOpenHelper sqliteOpenHelper;

            publishProgress(SIGN_IN_PROGRESS_START);
            //do something?

            publishProgress(SIGN_IN_PROGRESS_LOAD_USER_INFO);

            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            SqliteOpenHelper.UserInfo userInfo = sqliteOpenHelper.getUserInfo(email);
            sqliteOpenHelper.close();

            publishProgress(SIGN_IN_PROGRESS_CHECK_EMAIL);

            if (userInfo == null || userInfo.m_email == null || userInfo.m_email.length() == 0) {
                return SIGN_IN_RESULT_ERROR_EMAIL_DOES_NOT_EXIST;
            }

            publishProgress(SIGN_IN_PROGRESS_CHECK_PASSWORD);

            if (userInfo.m_shadow == null || userInfo.m_shadow.length() == 0 || password == null || password.length() == 0 || ! userInfo.m_shadow.equals(Utilities.caculateDigist(email, password))) {
                return SIGN_IN_RESULT_ERROR_PASSWORD_INCORRECT;
            }

            publishProgress(SIGN_IN_PROGRESS_LOAD_RSA_KEY);

            String decrypted_publick_key = Utilities.tripleDesDecrypt(userInfo.m_public_key, password);
            String decrypted_private_key = Utilities.tripleDesDecrypt(userInfo.m_private_key, password);
            PublicKey publicKey = Utilities.decodePublicKey(decrypted_publick_key);
            PrivateKey privateKey = Utilities.decodePrivateKey(decrypted_private_key);

            if (publicKey == null || privateKey == null) {
                return SIGN_IN_RESULT_ERRIR_LOAD_RSA_KEY_FAILED;
            }

            publishProgress(SIGN_IN_PROGRESS_FINISHED);

            m_uiHandler.obtainMessage(R.integer.MESSAGE_SET_USER_INFO, new Utilities.SignInMessageObject(userInfo.m_uid, userInfo.m_email, publicKey, privateKey)).sendToTarget();

            m_uiHandler.sendEmptyMessage(R.integer.MESSAGE_LOAD_USER_DATA);

            return SIGN_IN_RESULT_SUCCESS;
        }

        @Override
        protected void onProgressUpdate(Integer... progress) {
            TextView progressMessageTextView = m_view.findViewById(R.id.sign_in_progress_message);

            switch (progress[0]) {
                case SIGN_IN_PROGRESS_START:
                    progressMessageTextView.setText(R.string.sign_in_progress_start);
                    break;
                case SIGN_IN_PROGRESS_LOAD_USER_INFO:
                    progressMessageTextView.setText(R.string.sign_in_progress_load_user_info);
                    break;
                case SIGN_IN_PROGRESS_CHECK_EMAIL:
                    progressMessageTextView.setText(R.string.sign_in_progress_check_email);
                    break;
                case SIGN_IN_PROGRESS_CHECK_PASSWORD:
                    progressMessageTextView.setText(R.string.sign_in_progress_check_password);
                    break;
                case SIGN_IN_PROGRESS_LOAD_RSA_KEY:
                    progressMessageTextView.setText(R.string.sign_in_progress_load_rsa_key);
                    break;
                case SIGN_IN_PROGRESS_FINISHED:
                    progressMessageTextView.setText(R.string.sign_in_progress_finish);
                    break;
                default:
            }
        }

        @Override
        protected void onPostExecute(Integer result) {
            switch (result) {
                case SIGN_IN_RESULT_ERROR_EMAIL_DOES_NOT_EXIST:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_in_result_error_email_does_not_exist);
                    break;
                case SIGN_IN_RESULT_ERROR_PASSWORD_INCORRECT:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_in_result_error_password_incorrect);
                    break;
                case SIGN_IN_RESULT_ERRIR_LOAD_RSA_KEY_FAILED:
                    Utilities.showMessageBox(getContext(), R.string.error_dialog_title, R.string.sign_in_result_error_load_rsa_key_failed);
                    break;
                case SIGN_IN_RESULT_SUCCESS:
                    Utilities.jam(getContext(), R.string.sign_in_result_success);
                    dismiss();
                    break;
                default:
            }

            m_view.findViewById(R.id.sign_in_progress_panel).setVisibility(View.GONE);
            m_view.findViewById(R.id.sign_in_form_panel).setVisibility(View.VISIBLE);
        }
    }
}
