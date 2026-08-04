const { validate, rules, sendValidationError } = require('../middlewares/validate');
const FestivalVenue = require('../models/FestivalVenue');

class VenueController {
  /**
   * GET /api/v1/festivals/:festival_id/venues
   * Fetch all venues for a festival
   */
  static async getVenues(req, res) {
    try {
      const paramResult = validate(req.params, {
        festival_id: [rules.required(), rules.numeric(), rules.positiveInt()]
      });
      if (!paramResult.valid) {
        return sendValidationError(res, paramResult.errors);
      }

      const festivalId = parseInt(req.params.festival_id, 10);
      const venues = await FestivalVenue.findByFestivalId(festivalId);
      return res.json({ success: true, data: venues });
    } catch (err) {
      console.error('VenueController.getVenues error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch venues.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/venues/:venue_id
   * Fetch single venue details
   */
  static async getVenue(req, res) {
    try {
      const paramResult = validate(req.params, {
        festival_id: [rules.required(), rules.numeric(), rules.positiveInt()],
        venue_id: [rules.required(), rules.numeric(), rules.positiveInt()]
      });
      if (!paramResult.valid) {
        return sendValidationError(res, paramResult.errors);
      }

      const festivalId = parseInt(req.params.festival_id, 10);
      const venueId = parseInt(req.params.venue_id, 10);

      const venue = await FestivalVenue.findById(festivalId, venueId);
      if (!venue) {
        return res.status(404).json({ success: false, message: 'Venue not found.' });
      }

      return res.json({ success: true, data: venue });
    } catch (err) {
      console.error('VenueController.getVenue error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch venue.' });
    }
  }

  /**
   * POST /api/v1/festivals/:festival_id/venues
   * PUT  /api/v1/festivals/:festival_id/venues/:venue_id
   * Add a new venue (if venue_id is omitted) or Update an existing venue (if venue_id is provided)
   */
  static async addUpdateVenues(req, res) {
    try {
      const paramSchema = {
        festival_id: [rules.required(), rules.numeric(), rules.positiveInt()]
      };

      if (req.params.venue_id !== undefined) {
        paramSchema.venue_id = [rules.numeric(), rules.positiveInt()];
      }

      const paramResult = validate(req.params, paramSchema);
      if (!paramResult.valid) {
        return sendValidationError(res, paramResult.errors);
      }

      const festivalId = parseInt(req.params.festival_id, 10);
      const venueId = req.params.venue_id || (req.body && req.body.venue_id) || null;

      // Extract & validate body payload
      let venueData = req.body;
      if (req.body && req.body.venues !== undefined) {
        const bodyResult = validate(req.body, {
          venues: [rules.required(), rules.array()]
        });
        if (!bodyResult.valid) {
          return sendValidationError(res, bodyResult.errors);
        }
        venueData = req.body.venues;
      } else {
        const venueName = req.body?.venue_name || req.body?.name || (typeof req.body === 'string' ? req.body : null);
        const bodyResult = validate({ venue_name: venueName }, {
          venue_name: [rules.required(), rules.string(), rules.maxLength(255)]
        });
        if (!bodyResult.valid) {
          return sendValidationError(res, bodyResult.errors);
        }
      }

      const result = await FestivalVenue.addOrUpdateVenue(festivalId, venueData, venueId);
      if (!result.success) {
        return res.status(result.code || 400).json({ success: false, message: result.message });
      }

      const actionText = venueId ? 'updated' : 'added';
      return res.json({
        success: true,
        message: `Venue ${actionText} successfully.`,
        data: result.data
      });
    } catch (err) {
      console.error('VenueController.addUpdateVenues error:', err);
      return res.status(500).json({ success: false, message: 'Failed to process venue request.' });
    }
  }

  static async deleteVenue(req, res) {
    try {
      const paramSchema = {
        festival_id: [rules.required(), rules.numeric(), rules.positiveInt()],
        venue_id: [rules.required(), rules.numeric(), rules.positiveInt()]
      };

      const paramResult = validate(req.params, paramSchema);
      if (!paramResult.valid) {
        return sendValidationError(res, paramResult.errors);
      }

      const festivalId = parseInt(req.params.festival_id, 10);
      const venueId = parseInt(req.params.venue_id, 10);

      const result = await FestivalVenue.deleteVenue(festivalId, venueId);
      if (!result.success) {
        return res.status(result.code || 400).json({ success: false, message: result.message });
      }

      return res.json({
        success: true,
        message: 'Venue deleted successfully.',
        data: result.data
      });
    } catch (err) {
      console.error('VenueController.deleteVenue error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete venue.' });
    }
  }
}

module.exports = VenueController;
