require('dotenv').config();
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { google } = require('googleapis');
const axios = require('axios'); // Make sure to import axios

const YOUTUBE_API_KEY = "AIzaSyD-MPVRjHp0qVcgShSyyrD5oRzv_npoOeM";
const youtube = google.youtube({
    version: 'v3',
    auth: YOUTUBE_API_KEY
});

const MAIN_INDEX = 'analysistech'; // Define the main index

const flaskUrl = 'https://flasksentlyze.azurewebsites.net/predict';

router.get('/videos', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = 10;

    try {
        const body = await req.elasticClient.search({
            index: MAIN_INDEX,
            size: pageSize,
            from: (page - 1) * pageSize,
            _source: ["*"],
            _source_excludes: ["comments"],
            body: {
                query: {
                    bool: {
                        must: [
                            {
                                match_all: {}
                            }
                        ],
                        must_not: [
                            {
                                term: { "videoCategory.keyword": "NaN" }
                            }
                        ]
                    }
                }
            }
        });

        if (body.hits && body.hits.hits) {
            res.json({
                videos: body.hits.hits.map(hit => hit._source),
                currentPage: page,
                totalPages: Math.ceil(body.hits.total.value / pageSize),
                totalDataCount: body.hits.total.value
            });
        } else {
            throw new Error('Invalid response structure from Elasticsearch');
        }
    } catch (error) {
        console.error('Error retrieving videos:', error);
        res.status(500).json({ error: 'Error retrieving videos' });
    }
});


router.get('/videos/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const videoDocument = await req.elasticClient.get({
            index: MAIN_INDEX,
            id: videoId
        });

        res.json(videoDocument);
    } catch (error) {
        console.error('Error retrieving video:', error);
        res.status(500).json({ error: 'Error retrieving video' });
    }
});

router.get('/videoCount', async (req, res) => {
    console.log(`Elasticsearch URL: ${process.env.ELASTICSEARCH_URL}`);

    try {
        const response = await req.elasticClient.count({
            index: MAIN_INDEX
        });

        if (response && typeof response.count === 'number') {
            res.json({ count: response.count });
        } else {
            res.status(500).json({ error: "The count property is missing from the Elasticsearch response", count: 0 });
        }
    } catch (error) {
        console.error('Error counting videos:', error);
        res.status(500).json({ error: `Error counting videos: ${error.message}` });
    }
});

router.get('/videos/videoCategory/:category', async (req, res) => {
    try {
        const { category } = req.params;

        const response = await req.elasticClient.search({
            index: MAIN_INDEX,
            body: {
                query: {
                    term: {
                        videoCategory: category
                    }
                }
            }
        });

        const hits = response.hits;

        if (hits && hits.total.value > 0) {
            console.log('Videos retrieved successfully:', hits.hits.map(hit => hit._source));
            res.json(hits.hits.map(hit => hit._source));
        } else {
            console.log('No videos found for this category:', category);
            res.status(404).json({ error: 'No videos found for this category' });
        }
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Error fetching videos' });
    }
});

router.get('/videos/brands/:brand', async (req, res) => {
    try {
        const { selectedBrand } = req.params;
        const brandCategory = 'brand';
        const response = await req.elasticClient.search({
            index: MAIN_INDEX,
            body: {
                query: {
                    term: {
                        videoCategory: brandCategory,
                        brandName: selectedBrand
                    }
                }
            }
        });

        const hits = response.hits;

        if (hits && hits.total.value > 0) {
            res.json(hits.hits.map(hit => hit._source));
        } else {
            console.log('No videos found for this category:', category);
            res.status(404).json({ error: 'No videos found for this category' });
        }
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Error fetching videos' });
    }
});

// Videos DELETE methods
router.delete('/videos/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const response = await req.elasticClient.delete({
            index: MAIN_INDEX,
            id: videoId
        });

        console.log('Delete response:', response);
        res.status(200).json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ error: 'Error deleting video' });
    }
});

// Videos POST methods
router.post('/videos', async (req, res) => {
    try {
        const videoData = req.body;
        console.log(videoData['videoId']);

        const response = await req.elasticClient.index({
            index: MAIN_INDEX,
            body: videoData,
            id: videoData['videoId']
        });

        console.log(videoData);
        res.status(201).json({ message: 'Video and comments added successfully to Elasticsearch' });
    } catch (error) {
        console.error('Error in adding video to Elasticsearch:', error);
        res.status(500).json({ error: 'Error adding video and comments' });
    }
});

// Analyze methods
router.get('/analyze/:videoId', async (req, res) => {
    const { videoId } = req.params;

    console.log(`Attempting to fetch document for videoId: ${videoId}`);

    try {
        // Fetch comments from Elasticsearch using videoId
        const esResponse = await req.elasticClient.get({
            index: MAIN_INDEX,
            id: videoId
        });

        console.log("Elasticsearch response:", esResponse);

        if (!esResponse.found) {
            console.log("Document not found for videoId:", videoId);
            return res.status(404).json({ error: 'Document not found' });
        }

        const comments = extractComments(esResponse);
        console.log("Extracted comments:", comments);

        if (!comments || comments.length === 0) {
            console.log("No valid comments extracted.");
            return res.status(404).json({ error: 'No valid comments extracted' });
        }

        console.log(`Comments extracted for videoId: ${videoId}: ${comments.length} comments found`);

        // Combine comments into a single paragraph
        const combinedComments = comments.join(' ');
        console.log('Combined comments:', combinedComments);

        // Send combined comments to the Python server for predictions
        const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        console.log('Received prediction:', prediction);

        return res.json({ videoId, prediction });
    } catch (error) {
        console.error("Error communicating with Elasticsearch or Python server:", error);
        return res.status(500).json({ error: 'Error processing the request' });
    }
});

router.get('/analyze/customVideo/:videoId', async (req, res) => {
    const { videoId } = req.params;

    try {
        console.log(`Fetching comments for videoId: ${videoId}`);

        // Fetch comments from YouTube
        const comments = await fetchYouTubeComments(videoId);

        if (!comments.length) {
            return res.status(404).json({ error: 'No comments found for this video' });
        }

        console.log(`Fetched ${comments.length} comments for videoId: ${videoId}`);

        // Combine comments into a single paragraph
        const combinedComments = comments.join(' ');

        // Send combined comments to the Flask server for predictions
        const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        console.log('Received prediction from Flask server:', prediction);

        return res.json({ videoId, prediction });
    } catch (error) {
        console.error('Error processing the request:', error);
        return res.status(500).json({ error: 'Error processing the request' });
    }
});

router.get('/analyze/keyword/:keyword', async (req, res) => {
    const { keyword } = req.params;

    console.log(`Attempting to fetch comments containing keyword: ${keyword}`);

    try {
        // Search for comments containing the keyword across all videos
        const esResponse = await req.elasticClient.search({
            index: MAIN_INDEX,
            size: 1000, // Adjust size if needed
            body: {
                query: {
                    bool: {
                        must: {
                            match: {
                                "comments.snippet.topLevelComment.snippet.textDisplay": keyword
                            }
                        }
                    }
                }
            }
        });

        const hits = esResponse.hits.hits;

        if (!hits.length) {
            console.log(`No comments found containing the keyword: ${keyword}`);
            return res.status(404).json({ error: 'No comments found containing the keyword' });
        }

        const comments = hits.flatMap(hit => extractKeyword(hit, keyword));
        if (comments.length === 0) {
            console.log("No valid comments extracted.");
            return res.status(404).json({ error: 'No valid comments extracted' });
        }

        console.log(`Comments extracted containing the keyword: ${keyword}: ${comments.length} comments found`);
        console.log('Extracted comments:', comments);

        // Combine comments into a single paragraph
        const combinedComments = comments.join(' ');
        console.log('Combined comments:', combinedComments);

        // Send combined comments to the Python server for predictions
        const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        console.log('Received prediction:', prediction);

        return res.json({ keyword, prediction });
    } catch (error) {
        console.error("Error communicating with Elasticsearch or Python server:", error);
        return res.status(500).json({ error: 'Error processing the request' });
    }
});

router.get('/analyze/:videoId/commentsBefore/:date', async (req, res) => {
    try {
        const { videoId, date } = req.params;

        const [day, month, year] = date.split('-');
        const formattedDate = `${year}-${month}-${day}T00:00:00.000Z`;

        const response = await req.elasticClient.get({
            index: MAIN_INDEX,
            id: videoId
        });

        if (response.found) {
            const comments = response._source.comments.filter(comment => 
                new Date(comment.snippet.topLevelComment.snippet.publishedAt) < new Date(formattedDate)
            );

            comments.forEach(comment => {
                console.log("Comment Date:", comment.snippet.topLevelComment.snippet.publishedAt);
            });

            if (comments.length > 0) {
                const combinedComments = comments.map(comment => comment.snippet.topLevelComment.snippet.textDisplay).join(' ');

                const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
                const prediction = pyResponse.data.prediction;

                res.json({ videoId, prediction });
            } else {
                res.status(404).json({ error: 'No comments found before this date' });
            }
        } else {
            res.status(404).json({ error: 'No document found for this videoId' });
        }
    } catch (error) {
        console.error('Error retrieving comments:', error);
        res.status(500).json({ error: 'Error retrieving comments' });
    }
});

router.get('/analyze/:videoId/commentsAfter/:date', async (req, res) => {
    try {
        const { videoId, date } = req.params;

        const [day, month, year] = date.split('-');
        const formattedDate = `${year}-${month}-${day}T00:00:00.000Z`;

        const response = await req.elasticClient.get({
            index: MAIN_INDEX,
            id: videoId
        });

        if (response.found) {
            const comments = response._source.comments.filter(comment => 
                new Date(comment.snippet.topLevelComment.snippet.publishedAt) > new Date(formattedDate)
            );

            comments.forEach(comment => {
                console.log("Comment Date:", comment.snippet.topLevelComment.snippet.publishedAt);
            });

            if (comments.length > 0) {
                const combinedComments = comments.map(comment => comment.snippet.topLevelComment.snippet.textDisplay).join(' ');

                const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
                const prediction = pyResponse.data.prediction;

                res.json({ videoId, prediction });
            } else {
                res.status(404).json({ error: 'No comments found after this date' });
            }
        } else {
            res.status(404).json({ error: 'No document found for this videoId' });
        }
    } catch (error) {
        console.error('Error retrieving comments:', error);
        res.status(500).json({ error: 'Error retrieving comments' });
    }
});

router.get('/analyze/:videoId/commentsBetween/:startDate/:endDate', async (req, res) => {
    try {
        const { videoId, startDate, endDate } = req.params;

        const [startDay, startMonth, startYear] = startDate.split('-');
        const [endDay, endMonth, endYear] = endDate.split('-');
        const formattedStartDate = `${startYear}-${startMonth}-${startDay}T00:00:00.000Z`;
        const formattedEndDate = `${endYear}-${endMonth}-${endDay}T00:00:00.000Z`;

        const response = await req.elasticClient.get({
            index: MAIN_INDEX,
            id: videoId
        });

        if (response.found) {
            const comments = response._source.comments.filter(comment => {
                const commentDate = new Date(comment.snippet.topLevelComment.snippet.publishedAt);
                return commentDate >= new Date(formattedStartDate) && commentDate <= new Date(formattedEndDate);
            });

            comments.forEach(comment => {
                console.log("Comment Date:", comment.snippet.topLevelComment.snippet.publishedAt);
            });

            if (comments.length > 0) {
                const combinedComments = comments.map(comment => comment.snippet.topLevelComment.snippet.textDisplay).join(' ');

                const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
                const prediction = pyResponse.data.prediction;

                res.json({ videoId, prediction });
            } else {
                res.status(404).json({ error: 'No comments found between these dates' });
            }
        } else {
            res.status(404).json({ error: 'No document found for this videoId' });
        }
    } catch (error) {
        console.error('Error retrieving comments:', error);
        res.status(500).json({ error: 'Error retrieving comments' });
    }
});

router.get('/analyze/customVideoAfter/:videoId/:date', async (req, res) => {
    try {
        const { videoId, date } = req.params;

        const [day, month, year] = date.split('-');
        const formattedDate = `${year}-${month}-${day}T00:00:00.000Z`;

        console.log(`Fetching comments for videoId: ${videoId}`);

        const comments = await fetchYouTubeCommentsWithDate(videoId);

        const filteredComments = comments.filter(comment => new Date(comment.publishedAt) > new Date(formattedDate));

        console.log(`Comments after ${formattedDate}: ${filteredComments.length}`);
        
        if (filteredComments.length > 0) {
            const combinedComments = filteredComments.map(comment => comment.textDisplay).join(' ');

            const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
            const prediction = pyResponse.data.prediction;

            res.json({ videoId, prediction });
        } else {
            res.status(404).json({ error: 'No comments found after this date' });
        }
    } catch (error) {
        console.error('Error retrieving comments:', error);
        res.status(500).json({ error: 'Error retrieving comments' });
    }
});

// CustomVideoBefore endpoint
router.get('/analyze/customVideoBefore/:videoId/:date', async (req, res) => {
    try {
        const { videoId, date } = req.params;

        const [day, month, year] = date.split('-');
        const formattedDate = `${year}-${month}-${day}T00:00:00.000Z`;

        console.log(`Fetching comments for videoId: ${videoId} before ${formattedDate}`);

        const comments = await fetchYouTubeCommentsWithDate(videoId);

        const filteredComments = comments.filter(comment => new Date(comment.publishedAt) < new Date(formattedDate));
        
        if (filteredComments.length === 0) {
            return res.status(404).json({ error: 'No comments found before this date' });
        }

        console.log(`Fetched ${filteredComments.length} comments before ${formattedDate}`);

        const combinedComments = filteredComments.map(comment => comment.textDisplay).join(' ');

        const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        res.json({ videoId, prediction });
    } catch (error) {
        console.error('Error processing the request:', error);
        res.status(500).json({ error: 'Error processing the request' });
    }
});

// CustomVideoBetween endpoint
router.get('/analyze/customVideoBetween/:videoId/:startDate/:endDate', async (req, res) => {
    try {
        const { videoId, startDate, endDate } = req.params;

        const [startDay, startMonth, startYear] = startDate.split('-');
        const [endDay, endMonth, endYear] = endDate.split('-');
        const formattedStartDate = `${startYear}-${startMonth}-${startDay}T00:00:00.000Z`;
        const formattedEndDate = `${endYear}-${endMonth}-${endDay}T00:00:00.000Z`;

        console.log(`Fetching comments for videoId: ${videoId} between ${formattedStartDate} and ${formattedEndDate}`);

        const comments = await fetchYouTubeCommentsWithDate(videoId);

        const filteredComments = comments.filter(comment => {
            const commentDate = new Date(comment.publishedAt);
            return commentDate >= new Date(formattedStartDate) && commentDate <= new Date(formattedEndDate);
        });
        
        if (filteredComments.length === 0) {
            return res.status(404).json({ error: 'No comments found between these dates' });
        }

        console.log(`Fetched ${filteredComments.length} comments between ${formattedStartDate} and ${formattedEndDate}`);
       
        const combinedComments = filteredComments.map(comment => comment.textDisplay).join(' ');

        const pyResponse = await axios.post(flaskUrl, { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        res.json({ videoId, prediction });
    } catch (error) {
        console.error('Error processing the request:', error);
        res.status(500).json({ error: 'Error processing the request' });
    }
});

function extractComments(response) {
    if (!response._source || !response._source.comments) {
        console.log("No comments found in the response.");
        return [];
    }

    return response._source.comments.map(comment =>
        comment.snippet.topLevelComment.snippet.textDisplay
    ).filter(Boolean);
}

function extractKeyword(hit, keyword) {
    if (!hit._source || !hit._source.comments) {
        console.log("No comments found in the response.");
        return [];
    }

    return hit._source.comments
        .map(comment => comment.snippet.topLevelComment.snippet.textDisplay)
        .filter(commentText => commentText.includes(keyword));
}

async function fetchYouTubeComments(videoId) {
    let comments = [];
    let nextPageToken = '';
    try {
        do {
            const response = await youtube.commentThreads.list({
                part: 'snippet',
                videoId: videoId,
                maxResults: 100, // Adjust this as needed
                pageToken: nextPageToken
            });

            comments = comments.concat(response.data.items.map(item => item.snippet.topLevelComment.snippet.textDisplay));
            nextPageToken = response.data.nextPageToken;
        } while (nextPageToken);

        return comments;
    } catch (error) {
        console.error('Error fetching comments from YouTube:', error);
        throw error;
    }
}

async function fetchYouTubeCommentsWithDate(videoId) {
    let comments = [];
    let nextPageToken = '';
    try {
        do {
            const response = await youtube.commentThreads.list({
                part: 'snippet',
                videoId: videoId,
                maxResults: 100, // Adjust this as needed
                pageToken: nextPageToken
            });

            comments = comments.concat(response.data.items.map(item => item.snippet.topLevelComment.snippet));
            nextPageToken = response.data.nextPageToken;
        } while (nextPageToken);

        return comments;
    } catch (error) {
        console.error('Error fetching comments from YouTube:', error);
        throw error;
    }
}

module.exports = router;
