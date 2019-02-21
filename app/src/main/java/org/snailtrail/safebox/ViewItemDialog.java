package org.snailtrail.safebox;

import android.app.AlertDialog;
import android.content.Context;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.AutoCompleteTextView;
import android.widget.EditText;
import android.widget.TextView;

import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;

public abstract class ViewItemDialog extends AlertDialog implements View.OnClickListener, View.OnTouchListener {
    public Handler m_uiHandler;
    public int m_resource;
    public View m_view;
    public PublicKey m_publicKey;
    public PrivateKey m_privateKey;
    public SqliteOpenHelper.ItemInfo m_itemInfo;


    public ViewItemDialog(Context context, int resource, Handler uiHandler, PrivateKey privateKey) {
        super(context);
        m_resource = resource;
        m_uiHandler = uiHandler;
        m_privateKey = privateKey;
        m_itemInfo = null;
    }

    public abstract void composeUserData();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LayoutInflater inflater = (LayoutInflater) getContext().getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        m_view = inflater.inflate(m_resource, null);
        setContentView(m_view);

        setCancelable(false);

        //m_view.findViewById(R.id.view_item_cancel_button).setOnClickListener(this);
        //m_view.findViewById(R.id.view_item_create_button).setOnClickListener(this);
        m_view.setOnTouchListener(this);

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    @Override
    public void dismiss() {
        m_view.setOnTouchListener(null);
        //m_view.findViewById(R.id.view_item_create_button).setOnClickListener(null);
        //m_view.findViewById(R.id.view_item_cancel_button).setOnClickListener(null);

        super.dismiss();
    }

    @Override
    public void onClick(View view) {
        switch (view.getId()) {
            case R.id.create_item_create_button:
                onClickCreate(view);
                break;
            case R.id.create_item_cancel_button:
                onClickCancel(view);
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

    private void onClickCancel(View view) {
        dismiss();
    }

    private void onClickCreate(View view) {
        AutoCompleteTextView emailView = findViewById(R.id.sign_up_email);
        EditText passwordView = findViewById(R.id.sign_up_password);

        String email = emailView.getText().toString();
        String password = passwordView.getText().toString();

        InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(view.getWindowToken(), 0);

        m_view.findViewById(R.id.create_item_form_panel).setVisibility(View.GONE);
        m_view.findViewById(R.id.create_item_progress_panel).setVisibility(View.VISIBLE);

        new CreateItemTask().execute(email, password);
    }

    private class CreateItemTask extends AsyncTask<String, Integer, Integer> {

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
