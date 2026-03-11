import { Link } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

export default function Navbar(){

const {user} = useContext(AuthContext)

return(

<div className="navbar">

<h2>StoryBot AI</h2>

<div className="nav-links">

<Link to="/">Home</Link>

{user && <Link to="/chatbot">Chatbot</Link>}

{user?.role === "ANNOTATOR" && (
<Link to="/annotator">Annotator</Link>
)}

</div>

</div>

)

}