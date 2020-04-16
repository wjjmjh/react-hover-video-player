import React from 'react';
import { cx } from 'emotion';

import {
  VIDEO_STATE,
  getVideoState,
  formatVideoSrc,
  formatVideoCaptions,
} from './utils';
import styles from './styles';

// Enumerates states that the hover player can be in
const HOVER_PLAYER_STATE = {
  paused: 'paused',
  loading: 'loading',
  playing: 'playing',
};

/**
 * @typedef   {object}  VideoSource
 * @property  {string}  src - The src URL string to use for a video player source
 * @property  {string}  type - The media type of the video, ie 'video/mp4'
 */

/**
 * @typedef   {object}  VideoCaptionsTrack
 * @property  {string}  src - The src URL string for the captions track file
 * @property  {string}  srcLang - The language code for the language that these captions are in
 * @property  {string}  label - The title of the captions track
 */

/**
 * @component HoverVideoPlayer
 *
 * @param {!(string|string[]|VideoSource|VideoSource[])}  videoSrc - Source(s) to use for the video player. Accepts 3 different formats:
 *                                                                   - **String**: the URL string to use as the video player's src
 *                                                                   - **Object**: an object with attributes:
 *                                                                     - src: The src URL string to use for a video player source
 *                                                                     - type: The media type of the video source, ie 'video/mp4'
 *                                                                   - **Array**: if you would like to provide multiple sources, you can provide an array of URL strings and/or objects with the shape described above
 * @param {!(string|string[]|VideoCaptionsTrack|VideoCaptionsTrack[])} videoCaptions - Captions track(s) to use for the video player for accessibility. Accepts 3 different formats:
 *                                                                                     - **String**: the URL string to use as the captions track's src
 *                                                                                     - **Object**: an object with attributes:
 *                                                                                       - src: The src URL string for the captions track file
 *                                                                                       - srcLang: The language code for the language that these captions are in (ie, 'en', 'es', 'fr')
 *                                                                                       - label: The title of the captions track
 *                                                                                     - **Array**: if you would like to provide multiple caption tracks, you can provide an array of objects with the shape described above
 * @param {bool}    [isFocused=false] - Offers a prop interface for forcing the video to start/stop without DOM events
 *                                        When set to true, the video will begin playing and any events that would normally
 *                                        stop it will be ignored
 * @param {node}    [pausedOverlay] - Contents to render over the video while it's not playing
 * @param {node}    [loadingOverlay] - Contents to render over the video while it's loading
 * @param {number}  [loadingStateTimeoutDuration=200] - Duration in ms to wait after attempting to start the video before showing the loading overlay
 * @param {number}  [overlayFadeTransitionDuration=400] - The transition duration in ms for how long it should take for the overlay to fade in/out
 * @param {bool}    [shouldRestartOnVideoStopped=true] - Whether the video should reset to the beginning every time it stops playing after the user mouses out of the player
 * @param {bool}    [shouldUseOverlayDimensions=true] - Whether the player should display using the pausedOverlay's dimensions rather than the video element's dimensions if an overlay is provided
 *                                                        This helps prevent content height jumps when the video loads its dimensions
 * @param {bool}    [isVideoMuted=true] - Whether the video player should be muted
 * @param {bool}    [shouldVideoLoop=true] - Whether the video player should loop when it reaches the end
 * @param {string}  [className] - Optional className to apply custom styling to the container element
 * @param {string}  [pausedOverlayWrapperClassName] - Optional className to apply custom styling to the overlay contents' wrapper
 * @param {string}  [loadingOverlayWrapperClassName] - Optional className to apply custom styling to the loading state overlay contents' wrapper
 * @param {string}  [videoClassName] - Optional className to apply custom styling to the video element
 * @param {object}  [style] - Style object to apply custom CSS styles to the hover player container
 *
 * @license MIT
 */
export default function HoverVideoPlayer({
  videoSrc,
  videoCaptions,
  isFocused = false,
  pausedOverlay = null,
  loadingOverlay = null,
  loadingStateTimeoutDuration = 200,
  overlayFadeTransitionDuration = 400,
  shouldRestartOnVideoStopped = true,
  shouldUseOverlayDimensions = true,
  isVideoMuted = true,
  shouldVideoLoop = true,
  className = '',
  pausedOverlayWrapperClassName = '',
  loadingOverlayWrapperClassName = '',
  videoClassName = '',
  style = null,
}) {
  // Keep track of state to determine how the paused and loading overlays should be displayed
  const [overlayState, setOverlayState] = React.useState(
    HOVER_PLAYER_STATE.paused
  );

  // Keep a ref for all state variables related to attempting to play
  // the video which need to be managed asynchronously
  const mutablePlayAttemptState = React.useRef(null);

  if (mutablePlayAttemptState.current === null) {
    // Set initial values for our play attempt state
    mutablePlayAttemptState.current = {
      playPromise: Promise.resolve(),
      isPlayAttemptInProgress: false,
      isPlayAttemptCancelled: false,
    };
  }

  // Element refs
  const containerRef = React.useRef();
  const videoRef = React.useRef();

  // Refs for timeouts so we can keep track of and cancel them
  const pauseTimeoutRef = React.useRef();
  const loadingStateTimeoutRef = React.useRef();

  /**
   * @function playVideo
   *
   * Starts an attempt to play the video element and returns a promise which will
   * resolve when the video starts playing or reject if an error occurs
   */
  const playVideo = React.useCallback(() => {
    // Indicate that we are now attempting to play the video
    mutablePlayAttemptState.current.isPlayAttemptInProgress = true;

    const videoElement = videoRef.current;

    // Start playing the video and hang onto the play promise it returns
    let playPromise = videoElement.play();

    if (!playPromise || !playPromise.then) {
      // If videoElement.play() didn't return a promise, we'll manually create one
      // ourselves which mimics the same behavior
      playPromise = new Promise((resolve, reject) => {
        // Set up event listener to resolve the promise when the video player starts playing
        const onVideoPlaybackStarted = () => {
          resolve();
          videoElement.removeEventListener('playing', onVideoPlaybackStarted);
        };
        videoElement.addEventListener('playing', onVideoPlaybackStarted);

        // Set up event listener to reject the promise when the video player encounters an error
        const onVideoPlaybackFailed = (event) => {
          reject(event.error);
          videoElement.removeEventListener('error', onVideoPlaybackFailed);
        };
        videoElement.addEventListener('error', onVideoPlaybackFailed);
      });
    }

    // Keep a ref to the promise so we can use it later
    mutablePlayAttemptState.current.playPromise = playPromise;
    return playPromise;
  }, []);

  /**
   * @function  pauseVideo
   *
   * Pauses the video if the play attempt is completed or cancels the play attempt so the video
   * will be paused as soon as it finishes
   */
  const pauseVideo = React.useCallback(() => {
    if (mutablePlayAttemptState.current.isPlayAttemptInProgress) {
      // If we have a play attempt in progress, mark that the play attempt should be cancelled
      // so that as soon as the play promise resolves, the video should be paused
      mutablePlayAttemptState.current.isPlayAttemptCancelled = true;
    } else {
      // If we can safely pause, go for it!
      const videoElement = videoRef.current;
      videoElement.pause();

      if (shouldRestartOnVideoStopped) {
        // If we should restart the video, reset its time to the beginning
        videoElement.currentTime = 0;
      }
    }
  }, [shouldRestartOnVideoStopped]);

  /**
   * @function  onHoverStart
   *
   * Starts the video when the user mouses hovers on the player
   */
  const onHoverStart = React.useCallback(() => {
    // Clear any timeouts that may have been in progress
    clearTimeout(pauseTimeoutRef.current);
    clearTimeout(loadingStateTimeoutRef.current);

    // Make sure our play attempt is no longer cancelled since the user is hovering on it again
    mutablePlayAttemptState.current.isPlayAttemptCancelled = false;

    // If the video is already playing, just make sure we keep the overlays hidden
    if (getVideoState(videoRef.current) === VIDEO_STATE.playing) {
      setOverlayState(HOVER_PLAYER_STATE.playing);
      return;
    }

    if (loadingOverlay) {
      // If we have a loading overlay, start a timeout to fade it in if it takes too long
      // for playback to start
      loadingStateTimeoutRef.current = setTimeout(() => {
        // If the video is still loading when this timeout completes, transition the
        // player to show a loading state
        setOverlayState(HOVER_PLAYER_STATE.loading);
      }, loadingStateTimeoutDuration);
    }

    // If a play attempt is already in progress, don't start a new one
    if (mutablePlayAttemptState.current.isPlayAttemptInProgress) return;

    playVideo()
      .catch((error) => {
        mutablePlayAttemptState.current.isPlayAttemptInProgress = false;
        clearTimeout(loadingStateTimeoutRef.current);

        console.error(
          `HoverVideoPlayer playback failed for src ${videoRef.current.currentSrc}: ${error}`
        );

        // Revert to paused state
        pauseVideo();
      })
      .then(() => {
        mutablePlayAttemptState.current.isPlayAttemptInProgress = false;
        clearTimeout(loadingStateTimeoutRef.current);

        if (mutablePlayAttemptState.current.isPlayAttemptCancelled) {
          // If the play attempt was cancelled, immediately pause the video
          mutablePlayAttemptState.current.isPlayAttemptCancelled = false;
          pauseVideo();
        } else {
          // If the play attempt wasn't cancelled, hide the overlays to reveal the video now that it's playing
          setOverlayState(HOVER_PLAYER_STATE.playing);
        }
      });
  }, [loadingOverlay, loadingStateTimeoutDuration, pauseVideo, playVideo]);

  /**
   * @function  onHoverEnd
   *
   * Stops the video and fades the paused overlay in when the stops hovering on the player
   */
  const onHoverEnd = React.useCallback(() => {
    // Clear any timeouts that may have been in progress
    clearTimeout(loadingStateTimeoutRef.current);
    clearTimeout(pauseTimeoutRef.current);

    // If the isFocused override prop is active, ignore any other events attempting to stop the video
    // Also don't do anything if the video is already paused
    if (isFocused || getVideoState(videoRef.current) === VIDEO_STATE.paused)
      return;

    // Start fading the paused overlay back in
    setOverlayState(HOVER_PLAYER_STATE.paused);

    // Set a timeout with a duration of the overlay's fade transition so the video
    // won't pause until it's fully hidden
    pauseTimeoutRef.current = setTimeout(
      () => pauseVideo(),
      // If we don't have to wait for the overlay to fade back in, just set the timeout to 0 to invoke it ASAP
      pausedOverlay ? overlayFadeTransitionDuration : 0
    );
  }, [isFocused, overlayFadeTransitionDuration, pauseVideo, pausedOverlay]);

  /* ~~~~ EFFECTS ~~~~ */
  React.useEffect(() => {
    // Use effect to start/stop the video when isFocused override prop changes
    if (isFocused) {
      onHoverStart();
    } else {
      onHoverEnd();
    }

    // We really only want to fire this effect when the isFocused prop changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  React.useEffect(() => {
    // Event listener pauses the video when the user touches somewhere outside of the player
    const onWindowTouchStart = (event) => {
      if (!containerRef.current.contains(event.target)) {
        onHoverEnd();
      }
    };

    window.addEventListener('touchstart', onWindowTouchStart);

    // Remove the event listener on cleanup
    return () => window.removeEventListener('touchstart', onWindowTouchStart);
  }, [onHoverEnd]);

  React.useEffect(() => {
    // Manually setting the `muted` attribute on the video element via an effect in order
    // to avoid a know React issue with the `muted` prop not applying correctly on initial render
    // https://github.com/facebook/react/issues/10389
    videoRef.current.muted = isVideoMuted;
  }, [isVideoMuted]);

  React.useEffect(() => {
    // Ensure casting controls aren't shown on the video
    videoRef.current.disableRemotePlayback = true;

    return () => {
      // Clear any outstanding timeouts when the component unmounts to prevent memory leaks
      clearTimeout(loadingStateTimeoutRef.current);
      clearTimeout(pauseTimeoutRef.current);
      // If a play attempt is still in progress, cancel it so we don't update the state when it resolves
      mutablePlayAttemptState.current.isPlayAttemptCancelled = true;
    };
  }, []);
  /* ~~~~ END EFFECTS ~~~~ */

  /* ~~~~ PARSE VIDEO ASSETS ~~~~ */
  // Parse the `videoSrc` prop into an array of VideoSource objects to be used for the video player
  const parsedVideoSources = React.useMemo(() => formatVideoSrc(videoSrc), [
    videoSrc,
  ]);

  // Parse the `videoCaptions` prop into an array of VideoCaptionsTrack objects to be used for
  // captions tracks for the video player
  const parsedVideoCaptions = React.useMemo(
    () => formatVideoCaptions(videoCaptions),
    [videoCaptions]
  );
  /* ~~~~ END VIDEO ASSET PARSING ~~~~ */

  // The video should use the overlay's dimensions rather than the other way around if
  //  an overlay was provided and the shouldUseOverlayDimensions is true
  const shouldVideoExpandToFitOverlayDimensions =
    pausedOverlay && shouldUseOverlayDimensions;

  return (
    <div
      onMouseEnter={onHoverStart}
      onFocus={onHoverStart}
      onMouseOut={onHoverEnd}
      onBlur={onHoverEnd}
      onTouchStart={onHoverStart}
      className={cx(styles.basePlayerContainerStyle, className)}
      style={style}
      data-testid="hover-video-player-container"
      ref={containerRef}
    >
      {pausedOverlay && (
        <div
          style={{
            opacity: overlayState !== HOVER_PLAYER_STATE.playing ? 1 : 0,
            transition: `opacity ${overlayFadeTransitionDuration}ms`,
          }}
          className={cx(
            styles.basePausedOverlayStyle,
            {
              [styles.expandToCoverPlayerStyle]: !shouldVideoExpandToFitOverlayDimensions,
            },
            pausedOverlayWrapperClassName
          )}
          data-testid="paused-overlay-wrapper"
        >
          {pausedOverlay}
        </div>
      )}
      {loadingOverlay && (
        <div
          style={{
            opacity: overlayState === HOVER_PLAYER_STATE.loading ? 1 : 0,
            transition: `opacity ${overlayFadeTransitionDuration}ms`,
          }}
          className={cx(
            styles.baseLoadingOverlayStyle,
            styles.expandToCoverPlayerStyle,
            loadingOverlayWrapperClassName
          )}
          data-testid="loading-overlay-wrapper"
        >
          {loadingOverlay}
        </div>
      )}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        loop={shouldVideoLoop}
        playsInline
        // Only preload video data if we depend on having loaded its dimensions to display it
        preload={shouldVideoExpandToFitOverlayDimensions ? 'none' : 'metadata'}
        ref={videoRef}
        className={cx(
          styles.baseVideoStyle,
          {
            [styles.expandToCoverPlayerStyle]: shouldVideoExpandToFitOverlayDimensions,
          },
          videoClassName
        )}
      >
        {parsedVideoSources.map(({ src, type }) => (
          <source key={src} src={src} type={type} />
        ))}
        {parsedVideoCaptions.map(({ src, srcLang, label }) => (
          <track
            key={src}
            kind="captions"
            src={src}
            srcLang={srcLang}
            label={label}
          />
        ))}
      </video>
    </div>
  );
}
