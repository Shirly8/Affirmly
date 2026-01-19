from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS, cross_origin
import requests
import os

from callsql import save_entry

app = Flask(__name__, static_folder='static')
CORS(app, resources={r"/*": {"origins": "http://localhost:5173"}}, supports_credentials=True)


@app.route('/')
def home():
    return "Welcome to my Flask application!"

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'favicon.ico', mimetype='image/vnd.microsoft.icon')

@app.route('/api', methods=['POST'])
def classify_message():
    data = request.get_json()
    title = data.get("title", "")
    description = data.get("description", "")

    # Input validation
    if not title or not description:
        return jsonify({"error": "Title and description are required"}), 400

    # Construct the prompt
    prompt = f'''
    You are an affirmation generator. Generate a list of 10 affirmations based on the following.

    Title: "{title}"
    Description: "{description}"

    Based on the title and description, generate realistic but meaningful affirmations, encouraging yet realistic quotes or advice to uplift, motivate or help the individual who wrote this.
    Each response MUST be 1-3 sentences.
    These quotes or affirmations should be unique to the title and description and address the specific feelings and situation mentioned.

    Now generate 10 unique affirmations, quotes, or advice in a list like this:
    1.
    2.

    Do not generate anything else. Just the list of 10 affirmations.
    '''

    # Send request to Ollama API
    url = "http://localhost:11434/api/generate"
    headers = {
        "Content-Type": "application/json"
    }
    data = {
        "model": "phi3",
        "prompt": prompt,
        "stream": False
    }

    # Sending HTTP request
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Error making request: {e}")
        return jsonify({"error": str(e)}), 500

    # Parsing the response
    try:
        llmresponse = response.json()["response"]
        print(f"Ollama API response: {llmresponse}")  # Print the response for debugging
    except (ValueError, KeyError) as e:
        print(f"Error parsing response: {e}")
        return jsonify({"error": str(e)}), 500

    # Split the response into a list
    try:
        affirmations = llmresponse.strip().split("\n")[1:]  # Remove white space, split at new line
        affirmations = [a.split(". ")[1] for a in affirmations if ". " in a]
    except IndexError as e:
        print(f"Error processing affirmations: {e}")
        return jsonify({"error": "Error processing affirmations"}), 500

    return jsonify(affirmations), 200


@app.route('/save', methods=['POST'])
def save_journal_entry():
    data = request.get_json()
    response = save_entry(data)
    return jsonify(response), 200 


if __name__ == '__main__':
    app.run(port=5000, debug=True)
