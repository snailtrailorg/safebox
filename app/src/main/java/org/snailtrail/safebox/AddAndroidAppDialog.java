package org.snailtrail.safebox;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;

import java.security.PublicKey;

public class AddAndroidAppDialog extends AddItemDialog {

    public AddAndroidAppDialog(Context context, Handler uiHandler, PublicKey publicKey) {
        super(context, R.layout.add_android_app_dialog, uiHandler, publicKey);
    }

    @Override
    public void composeUserData() {

    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
