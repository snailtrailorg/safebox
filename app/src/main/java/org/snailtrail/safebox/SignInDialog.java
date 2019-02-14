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

        m_view.findViewById(R.id.sign_in_switch_sign_up_button).setOnClickListener(this);
        m_view.findViewById(R.id.sign_in_button).setOnClickListener(this);

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
        m_view.findViewById(R.id.sign_in_switch_sign_up_button).setOnClickListener(null);
        m_view.findViewById(R.id.sign_in_button).setOnClickListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.sign_in_switch_sign_up_button:
                OnClickSwitchSignUp(view);
                break;
            case R.id.sign_in_button:
                onClickSignIn(view);
                break;
            default:
                //do nothing
        }
    }

    private void OnClickSwitchSignUp(View view) {
        m_uiHandler.sendEmptyMessage(R.integer.action_sign_up);
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

        private static final int PROGRESS_START_SIGN_IN = 0;
        private static final int PROGRESS_LOAD_USER_INFO = 1;
        private static final int PROGRESS_CHECK_EMAIL = 2;
        private static final int PROGRESS_CHECK_PASSWORD = 3;
        private static final int PROGRESS_LOAD_RSA_KEY = 4;
        private static final int PROGRESS_FINISH_SIGN_IN = 5;

        private static final int RESULT_SUCCESS = 0;
        private static final int RESULT_ERROR_EMAIL_DOES_NOT_EXIST = 1;
        private static final int RESULT_ERROR_PASSWORD_INCORRECT = 2;
        private static final int RESULT_ERRIR_LOAD_RSA_KEY_FAILED = 3;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
        }

        @Override
        protected Integer doInBackground(String... parameter) {

            String email = parameter[0];
            String password = parameter[1];

            SqliteOpenHelper sqliteOpenHelper;

            publishProgress(PROGRESS_START_SIGN_IN);
            //do something?

            publishProgress(PROGRESS_LOAD_USER_INFO);

            sqliteOpenHelper = new SqliteOpenHelper(getContext());
            SqliteOpenHelper.UserInfo userInfo = sqliteOpenHelper.getUserInfo(email);
            sqliteOpenHelper.close();

            publishProgress(PROGRESS_CHECK_EMAIL);

            if (userInfo = null) {
                return RESULT_ERROR_EMAIL_DOES_NOT_EXIST;
            }

            publishProgress(PROGRESS_CHECK_PASSWORD);

            String shadow = Utilities.caculateDigist(email, password);
            if (userInfo.shadow != Utilities.caculateDigist(email, password)) {
                return RESULT_ERROR_PASSWORD_INCORRECT;
            }

            publishProgress(PROGRESS_LOAD_RSA_KEY);

            PublicKey public_key = Utilities.getPublicKey(userInfo.public_key);
            PrivateKey privateKey = Utilities.getPrivateKey(userInfo.private_key);

            if (public_key == null || privateKey == null) {
                return RESULT_ERRIR_LOAD_RSA_KEY_FAILED;
            }

            Message message = new Message();
            m_uiHandler.sendMessage();

            publishProgress(PROGRESS_FINISH_SIGN_IN);

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

                m_view.findViewById(R.id.sign_in_progress_panel).setVisibility(View.GONE);
                m_view.findViewById(R.id.sign_in_form_panel).setVisibility(View.VISIBLE);
            }
        }
    }
}
