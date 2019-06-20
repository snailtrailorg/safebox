package org.snailtrail.safebox;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;

import org.snailtrail.safebox.SafeRecyclerAdapter.SafeViewHolder;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.recyclerview.widget.RecyclerView;

public class SafeRecyclerView extends RecyclerView {

    private SafeViewHolder m_selectedViewHolder;
    private VelocityTracker m_velocityTracker;
    private float m_thresholdTranslationX;
    private float m_initialTouchX;
    private float m_initialTranslateX;
    private float m_lastTranslateX;
    private float m_touchSlop;
    private boolean m_bIsHorizontalSlide;

    public SafeRecyclerView(@NonNull Context context) {
        super(context);
    }

    public SafeRecyclerView(@NonNull Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
    }

    public SafeRecyclerView(@NonNull Context context, @Nullable AttributeSet attrs, int defStyle) {
        super(context, attrs, defStyle);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        m_selectedViewHolder = null;
        m_velocityTracker = VelocityTracker.obtain();
        m_thresholdTranslationX = 0.0f;
        m_initialTouchX = 0.0f;
        m_initialTranslateX = 0.0f;
        m_lastTranslateX = 0.0f;
        m_touchSlop = ViewConfiguration.get(getContext()).getScaledTouchSlop();
        m_bIsHorizontalSlide = false;
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:

                View view = findChildViewUnder(e.getX(), e.getY());
                SafeRecyclerAdapter.SafeViewHolder safeViewHolder = (view == null) ? null : (SafeRecyclerAdapter.SafeViewHolder) findContainingViewHolder(view);

                if (safeViewHolder != null) {
                    if (m_selectedViewHolder != null && m_selectedViewHolder != safeViewHolder && m_lastTranslateX != 0.0f) {
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
                    }

                    if (m_selectedViewHolder != safeViewHolder) {
                        m_selectedViewHolder = safeViewHolder;
                        m_initialTranslateX = 0.0f;
                        m_lastTranslateX = m_initialTranslateX;
                    } else {
                        m_initialTranslateX = m_lastTranslateX;
                    }

                    m_thresholdTranslationX = 0.0f - getViewWidthOverall(m_selectedViewHolder.m_delete) - getViewWidthOverall(m_selectedViewHolder.m_modify);
                    m_initialTouchX = e.getX();

                    m_velocityTracker.clear();
                    m_velocityTracker.addMovement(e);
                }

                m_bIsHorizontalSlide = false;
                return super.onInterceptTouchEvent(e);

            case MotionEvent.ACTION_MOVE:
                if (m_selectedViewHolder != null) {
                    m_velocityTracker.addMovement(e);
                    m_velocityTracker.computeCurrentVelocity(1000);

                    float velocityX = m_velocityTracker.getXVelocity();
                    float translateX = m_initialTranslateX + e.getX() - m_initialTouchX;

                    if (! m_bIsHorizontalSlide && Math.abs(translateX) > m_touchSlop) {
                        m_bIsHorizontalSlide = true;
                    }

                    if (m_bIsHorizontalSlide) {
                        if (translateX < 0.0f) {
                            float alpha = (m_thresholdTranslationX == 0.0f) ? 0.0f : (translateX / m_thresholdTranslationX);
                            alpha = (alpha < 0.0f) ? 0.0f : ((alpha > 1.0f) ? 1.0f : alpha);
                            m_selectedViewHolder.m_delete.setAlpha(alpha);
                            m_selectedViewHolder.m_modify.setAlpha(alpha);
                        }
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, translateX, velocityX);
                        m_lastTranslateX = translateX;
                    }
                    //m_selectedViewHolder.m_body.setTranslationX(m_initialTranslationX + e.getX() - m_initialTouchX);
                }

                if (m_bIsHorizontalSlide) {
                    return false;
                } else {
                    return super.onInterceptTouchEvent(e);
                }

            case MotionEvent.ACTION_CANCEL:
            case MotionEvent.ACTION_UP:
                if (m_selectedViewHolder != null) {
                    if (m_lastTranslateX <= m_thresholdTranslationX) {
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, m_thresholdTranslationX, 3000.0f);
                        m_lastTranslateX = m_thresholdTranslationX;
                    } else {
                        animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
                        m_lastTranslateX = 0.0f;
                    }
                }

                if (m_bIsHorizontalSlide) {
                    return true;
                } else {
                    return super.onInterceptTouchEvent(e);
                }

            default:
                return false;
        }
        //return super.onInterceptTouchEvent(e);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        return super.onTouchEvent(e);
    }

    public void resetItemTranslation() {
        if (m_selectedViewHolder != null && m_lastTranslateX != 0.0f) {
            animateTranslation(m_selectedViewHolder, m_lastTranslateX, 0.0f, 3000.0f);
            m_selectedViewHolder = null;
            m_initialTranslateX = 0.0f;
            m_lastTranslateX = m_initialTranslateX;
            m_bIsHorizontalSlide = false;
        }
    }

    public void animateTranslation(final SafeViewHolder safeViewHolder, float start, float stop, float velocity) {
        final View body = safeViewHolder.m_body;
        final float begin = start;
        final float end = stop;
        long duration = Math.abs((long)((end - begin) / ((velocity == 0) ? 100 : velocity) * 1000));

        ViewCompat.postOnAnimation(this, new Runnable() {
            @Override
            public void run() {
                body.setTranslationX(end);
            }
        });
    }

    public float getViewWidthOverall(View view) {
        ViewGroup.MarginLayoutParams layoutParams = (ViewGroup.MarginLayoutParams)view.getLayoutParams();
        return layoutParams.leftMargin + layoutParams.rightMargin + view.getWidth();
    }
}