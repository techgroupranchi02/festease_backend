/**
 * Media Helper Utility for generating media URLs matching Laravel model accessors
 */

function getMediaBaseUrl() {
  const prefix = process.env.auth_image_url_prefix || process.env.AUTH_IMAGE_URL_PREFIX || 'https://api.autovertest.com/api/v1/retrieve-media';
  return prefix.replace(/\/+$/, '');
}

/**
 * Accessor for profile_pic
 * Laravel equivalent: getProfilePicAttribute()
 */
function getProfilePic(imageName) {
  if (!imageName) return null;
  const baseUrl = getMediaBaseUrl();
  if (baseUrl.includes('api/v1/retrieve-media')) {
    return `${baseUrl}/images/users/${imageName}`;
  }
  return `${baseUrl}/api/v1/retrieve-media/images/users/${imageName}`;
}

/**
 * Accessor for thumbnail_pic
 * Laravel equivalent: getThumbnailPicAttribute()
 */
function getThumbnailPic(imageName) {
  if (!imageName) return null;
  const baseUrl = getMediaBaseUrl();
  if (baseUrl.includes('api/v1/retrieve-media')) {
    return `${baseUrl}/images/users/thumb_${imageName}`;
  }
  return `${baseUrl}/api/v1/retrieve-media/images/users/thumb_${imageName}`;
}

module.exports = {
  getProfilePic,
  getThumbnailPic
};
